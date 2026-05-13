# engine/video_branch.py
from pathlib import Path
import json, math, subprocess, os
from typing import List, Dict

from engine.utils_audio import ffmpeg_ensure_wav_16k_mono, vad_trim
from faster_whisper import WhisperModel

# ---------- сервис ----------

def _seconds_to_ts(t: float) -> str:
    ms = int(round(t * 1000))
    s = (ms // 1000) % 60
    m = (ms // 60000) % 60
    h = (ms // 3600000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms % 1000:03d}"

def _probe_duration_seconds(video_path: Path) -> float:
    try:
        out = subprocess.check_output([
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path)
        ], stderr=subprocess.STDOUT).decode("utf-8", "ignore").strip()
        return float(out)
    except Exception:
        return 0.0

def _detect_fps_ffprobe(video_path: Path) -> float:
    try:
        out = subprocess.check_output([
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path)
        ], stderr=subprocess.STDOUT).decode("utf-8", "ignore").strip()
        if "/" in out:
            num, den = out.split("/")
            return float(num) / float(den)
        return float(out)
    except Exception:
        return 25.0

# ---------- ключевые кадры ----------

def extract_keyframes(video_path: Path, out_dir: Path, max_per_min: int = 3, threshold: int = 30) -> List[Dict]:
    """
    Извлекаем ключевые кадры по сменам сцен (PySceneDetect). Фолбэк — регулярные точки.
    Сохраняем в <out_dir>/key_frames/*.jpg и метаданные в key_frames.json.
    """
    frames_dir = out_dir / "key_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    key_meta: List[Dict] = []
    times: List[float] = []

    try:
        from scenedetect import SceneManager, open_video, ContentDetector
        video = open_video(str(video_path))
        scene_manager = SceneManager()
        scene_manager.add_detector(ContentDetector(threshold=threshold))
        scene_manager.detect_scenes(video, show_progress=False)
        scenes = scene_manager.get_scene_list()
        times = [s[0].get_seconds() for s in scenes] or [0.0]
    except Exception:
        duration = _probe_duration_seconds(video_path)
        step = 20.0
        times = [i * step for i in range(int(duration // step) + 1)]

    duration = _probe_duration_seconds(video_path)
    max_frames = max(1, int(math.ceil((duration / 60.0) * max_per_min)))
    times = sorted(times)[:max_frames]

    for idx, sec in enumerate(times, start=1):
        out_jpg = frames_dir / f"{idx:04d}.jpg"
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{sec:.3f}",
            "-i", str(video_path),
            "-vframes", "1",
            "-q:v", "2",
            str(out_jpg)
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        key_meta.append({
            "time": _seconds_to_ts(sec),
            "path": str(out_jpg.relative_to(out_dir)),
            "score": 1.0
        })

    (out_dir / "key_frames.json").write_text(json.dumps(key_meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return key_meta

# ---------- OCR ----------

def run_ocr_on_frames(out_dir: Path, langs: str = "eng+rus", engine: str = "tesseract", min_conf: float = 0.0) -> List[Dict]:
    """
    OCR по key_frames/*.jpg. Возвращает [{time, frame, text, conf}, ...] и пишет ocr.json.
    """
    frames_dir = out_dir / "key_frames"
    if not frames_dir.exists():
        (out_dir / "ocr.json").write_text("[]", encoding="utf-8")
        return []

    results: List[Dict] = []
    key_list = json.loads((out_dir / "key_frames.json").read_text(encoding="utf-8"))

    if engine == "tesseract":
        import pytesseract
        from PIL import Image
        config = "--oem 3 --psm 6"
        for meta in key_list:
            img_path = out_dir / meta["path"]
            text = pytesseract.image_to_string(Image.open(img_path), lang=langs, config=config) or ""
            text = text.strip()
            if text:
                results.append({
                    "time": meta["time"],
                    "frame": meta["path"],
                    "text": text,
                    "conf": 1.0
                })

    elif engine == "paddle":
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang="en")
        for meta in key_list:
            img_path = str((out_dir / meta["path"]).resolve())
            result = ocr.ocr(img_path, cls=True)
            lines = []
            for page in result:
                for line in page:
                    txt = (line[1][0] or "").strip()
                    conf = float(line[1][1])
                    if txt and conf >= min_conf:
                        lines.append(txt)
            text = "\n".join(lines).strip()
            if text:
                results.append({
                    "time": meta["time"],
                    "frame": meta["path"],
                    "text": text,
                    "conf": 1.0
                })
    else:
        raise ValueError(f"Unknown OCR engine: {engine}")

    (out_dir / "ocr.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return results

# ---------- аудио извлечение и транскрипция ----------

def _ffmpeg_audio_extract(src: Path, dst_wav: Path, err_log: Path):
    dst_wav.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg","-y","-i", str(src), "-ac","1","-ar","16000","-vn", str(dst_wav)]
    with err_log.open("a", encoding="utf-8") as log:
        log.write(f"\n--- ffmpeg extract audio: {cmd}\n")
        proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=log)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg extract failed with code {proc.returncode}")

def _ffmpeg_normalize_container(src: Path, norm_mp4: Path, err_log: Path):
    """
    Нормализуем контейнер: копируем видео как есть, аудио перегоняем в AAC.
    """
    cmd = [
        "ffmpeg","-y","-i", str(src),
        "-c:v","copy",
        "-c:a","aac","-b:a","192k",
        str(norm_mp4)
    ]
    with err_log.open("a", encoding="utf-8") as log:
        log.write(f"\n--- ffmpeg normalize container: {cmd}\n")
        proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=log)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg normalize failed with code {proc.returncode}")

_model = None
def _get_or_init_model():
    global _model
    if _model is None:
        _model = WhisperModel(
            "small",
            device=os.getenv("SOVA_DEVICE", "cpu"),
            compute_type=os.getenv("SOVA_PRECISION", "int8"),
        )
    return _model

def transcribe_video_audio(video_path: Path, workdir: Path):
    """
    1) Пытаемся вытащить WAV напрямую
    2) Если падает → нормализуем контейнер (aac) и пробуем снова
    3) VAD + транскрипция
    """
    err_log = workdir / "error.log"

    wav = workdir / "audio_16k.wav"
    try:
        _ffmpeg_audio_extract(video_path, wav, err_log)
    except Exception:
        norm_mp4 = workdir / "normalized.mp4"
        _ffmpeg_normalize_container(video_path, norm_mp4, err_log)
        _ffmpeg_audio_extract(norm_mp4, wav, err_log)

    wav_vad = vad_trim(wav, aggressiveness=2)
    model = _get_or_init_model()

    segments, info = model.transcribe(
        str(wav_vad),
        task="transcribe",
        temperature=0.0,
        vad_filter=False,
        beam_size=5,
    )
    segs, full = [], []
    for s in segments:
        item = {"start": s.start, "end": s.end, "text": s.text}
        segs.append(item)
        full.append(s.text.strip())
    language = getattr(info, "language", None)
    return language, segs, "\n".join(full)

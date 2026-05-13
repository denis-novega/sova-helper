# engine/engine_core.py
from pathlib import Path
from faster_whisper import WhisperModel
from datetime import timedelta
import json, traceback, os

from engine.utils_audio import ffmpeg_ensure_wav_16k_mono, vad_trim
from engine import video_branch       # видео-ветка
from engine import slides_branch      # презентации (PPT/PPTX и PDF в режиме "slides")
from engine import web_branch         # веб-источники (URL) -> чистый текст/MD

_model = None


def get_model():
    """Ленивая инициализация модели Whisper."""
    global _model
    if _model is None:
        _model = WhisperModel(
            "small",
            device=os.getenv("SOVA_DEVICE", "cpu"),
            compute_type=os.getenv("SOVA_PRECISION", "int8"),
        )
    return _model


def _ts(t):
    td = timedelta(seconds=float(t))
    total = int(td.total_seconds() * 1000)
    ms = total % 1000
    s = (total // 1000) % 60
    m = (total // 60000) % 60
    h = (total // 3600000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _segments_to_vtt(segments):
    lines = ["WEBVTT\n"]
    for s in segments:
        lines.append(f"{_ts(s['start'])} --> {_ts(s['end'])}")
        lines.append(s["text"].strip())
        lines.append("")
    return "\n".join(lines)


def _run_whisper(model, audio_path: str, **kw):
    """Один прогон whisper с аккуратными параметрами. Возвращает (info, segs, full_text)."""
    defaults = dict(
        task="transcribe",
        temperature=0.0,
        no_speech_threshold=0.6,
        vad_filter=False,
        language=None,
        beam_size=5,
    )
    defaults.update(kw)
    segments, info = model.transcribe(audio_path, **defaults)
    segs, full = [], []
    for s in segments:
        item = {"start": s.start, "end": s.end, "text": s.text}
        segs.append(item)
        full.append(s.text.strip())
    return info, segs, "\n".join(full)


def transcribe_audio(in_path: Path, workdir: Path):
    """Надёжная трёхступенчатая транскрипция аудио."""
    wav = workdir / "audio_16k.wav"
    ffmpeg_ensure_wav_16k_mono(in_path, wav)

    model = get_model()
    debug = {"passes": []}

    # pass 1: VAD-трим
    wav_vad = vad_trim(wav, aggressiveness=2)
    info1, segs1, text1 = _run_whisper(model, str(wav_vad))
    debug["passes"].append({
        "pass": 1, "source": str(wav_vad.name),
        "language": getattr(info1, "language", None),
        "segments": len(segs1)
    })
    if len(segs1) > 0:
        return info1.language, text1, segs1, debug

    # pass 2: без VAD
    info2, segs2, text2 = _run_whisper(model, str(wav), vad_filter=False)
    debug["passes"].append({
        "pass": 2, "source": str(wav.name),
        "language": getattr(info2, "language", None),
        "segments": len(segs2)
    })
    if len(segs2) > 0:
        return info2.language, text2, segs2, debug

    # pass 3: принудительно ru + whisper VAD
    info3, segs3, text3 = _run_whisper(
        model, str(wav),
        language="ru", vad_filter=True, no_speech_threshold=0.4
    )
    debug["passes"].append({
        "pass": 3, "source": str(wav.name),
        "language": getattr(info3, "language", None),
        "segments": len(segs3),
        "forced_language": "ru",
        "whisper_vad": True
    })

    return getattr(info3, "language", "unk"), text3, segs3, debug


def _segments_to_plain_text(segs):
    """Склеиваем чистый текст без служебных строк."""
    parts = []
    for s in segs:
        t = (s.get("text") or "").strip()
        if t:
            parts.append(t)
    return " ".join(parts).strip()


def process_media(in_path: Path, out_dir: Path, lecture_type: str = "summary"):
    """
    Главная точка входа:
      - принимает файл (аудио, видео, документ, презентацию) или URL (через lecture_type="web")
      - пишет артефакты JSON/VTT/MD
      - возвращает краткий preview
    """
    try:
        AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"}
        VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".webm"}
        DOC_EXTS   = {".doc", ".docx", ".pdf", ".txt", ".md"}  # ← txt/md поддерживаются как обычные документы
        PRESENT_EXTS = {".ppt", ".pptx"}
        PDF_MAYBE_SLIDES = {".pdf"}  # PDF может быть презентацией, если lecture_type == "slides"

        out_dir.mkdir(parents=True, exist_ok=True)
        ext = in_path.suffix.lower()

        # ---- WEB URL (источники) ----
        if lecture_type == "web":
            # читаем URL: либо из ENV, либо из файла url.txt (in_path)
            target_url = os.getenv("SOVA_URL") or None
            if not target_url:
                url_file = in_path if in_path.suffix == ".txt" else None
                if url_file and url_file.exists():
                    target_url = url_file.read_text().strip()

            if not target_url:
                return {"status": "error", "message": "Не передан URL (нет поля url или файла .txt)"}

            out = web_branch.process_url(target_url, out_dir)

            # 🔧 ИСПРАВЛЕНО:
            # 1) пробрасываем ПОЛНЫЙ текст наверх в поле "text"
            # 2) doc_preview оставляем укороченным для карточек, но UI для preview берёт полный
            full_text = out.get("text") or ""
            return {
                "status": out.get("status", "error"),
                "mode": "web",
                "lecture_type": lecture_type,
                "meta": out.get("meta", {}),
                "artifacts": out.get("artifacts", {}),
                "text": full_text,                 # ← полный текст теперь есть в ответе
                "doc_preview": full_text[:800],    # ← короткий превью для карточек
            }

        # ---- АУДИО ----
        if ext in AUDIO_EXTS:
            lang, _full_text, segs, debug = transcribe_audio(in_path, out_dir)

            (out_dir / "transcript.json").write_text(
                json.dumps({"language": lang, "segments": segs}, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            (out_dir / "transcript.vtt").write_text(_segments_to_vtt(segs), encoding="utf-8")

            plain_text = _segments_to_plain_text(segs)
            (out_dir / "document.md").write_text(
                plain_text if plain_text else "(Пустая транскрипция — проверь аудио-файл)",
                encoding="utf-8"
            )

            return {
                "status": "ok" if segs else "empty",
                "mode": "audio",
                "language": lang,
                "segments": len(segs),
                "lecture_type": lecture_type,
                "artifacts": {
                    "vtt": str((out_dir / "transcript.vtt").resolve()),
                    "json": str((out_dir / "transcript.json").resolve()),
                    "doc_md": str((out_dir / "document.md").resolve()),
                },
                "doc_preview": (plain_text[:800] if plain_text else ""),
                "debug": debug,
            }

        # ---- ВИДЕО ----
        if ext in VIDEO_EXTS:
            lang, segs, _full = video_branch.transcribe_video_audio(in_path, out_dir)

            (out_dir / "transcript.json").write_text(
                json.dumps({"language": lang, "segments": segs}, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
            (out_dir / "transcript.vtt").write_text(_segments_to_vtt(segs), encoding="utf-8")

            key_meta = video_branch.extract_keyframes(in_path, out_dir, max_per_min=3, threshold=30)
            ocr = video_branch.run_ocr_on_frames(out_dir, langs="eng+rus", engine="tesseract", min_conf=0.0)

            plain_text = _segments_to_plain_text(segs)
            (out_dir / "document.md").write_text(
                plain_text if plain_text else "(Пустая транскрипция — проверь видео-файл)",
                encoding="utf-8"
            )

            return {
                "status": "ok" if segs else "empty",
                "mode": "video",
                "language": lang,
                "segments": len(segs),
                "lecture_type": lecture_type,
                "artifacts": {
                    "vtt": str((out_dir / "transcript.vtt").resolve()),
                    "json": str((out_dir / "transcript.json").resolve()),
                    "doc_md": str((out_dir / "document.md").resolve()),
                    "key_frames_json": str((out_dir / "key_frames.json").resolve()),
                    "ocr_json": str((out_dir / "ocr.json").resolve()),
                    "key_frames_dir": str((out_dir / "key_frames").resolve()),
                },
                "doc_preview": (plain_text[:800] if plain_text else ""),
                "debug": {
                    "video": True,
                    "key_frames": len(key_meta),
                    "ocr_items": len(ocr),
                },
            }

        # ---- ПРЕЗЕНТАЦИИ (PPT/PPTX и PDF при lecture_type="slides") ----
        if ext in PRESENT_EXTS or (ext in PDF_MAYBE_SLIDES and lecture_type == "slides"):
            out = slides_branch.process_slides(in_path, out_dir, do_ocr=True)
            outline = (out.get("outline") or "")
            slides = out.get("slides") or []

            return {
                "status": "ok" if outline.strip() else "empty",
                "mode": "slides",
                "language": "und",
                "segments": 0,
                "lecture_type": lecture_type,
                "artifacts": {
                    "doc_md": str((out_dir / "document.md").resolve()),
                    "slides_json": str((out_dir / "slides.json").resolve()),
                    "slides_dir": str((out_dir / "slides").resolve()),
                    "outline_md": str((out_dir / "outline.md").resolve()),
                },
                "doc_preview": outline[:800],
                "debug": {"slides": len(slides)},
            }

        # ---- ДОКУМЕНТЫ ----
        if ext in DOC_EXTS:
            text_md = ""

            try:
                if ext in {".doc", ".docx"}:
                    # импортим mammoth только если реально DOC/DOCX
                    try:
                        import mammoth  # type: ignore
                    except ImportError:
                        return {"status": "error", "message": "Для DOC/DOCX установи: pip install mammoth"}
                    with open(in_path, "rb") as f:
                        result = mammoth.convert_to_markdown(f)
                    text_md = result.value or ""

                elif ext == ".pdf":
                    # импортим pdfminer только когда нужен PDF
                    try:
                        from pdfminer.high_level import extract_text as pdf_text  # type: ignore
                    except ImportError:
                        return {"status": "error", "message": "Для PDF установи: pip install pdfminer.six"}
                    text_md = pdf_text(str(in_path)) or ""

                elif ext in {".txt", ".md"}:
                    # простые форматы — без внешних пакетов
                    text_md = in_path.read_text(encoding="utf-8", errors="ignore")

                else:
                    text_md = "(Неизвестный документный формат)"

                (out_dir / "document.md").write_text(
                    text_md if text_md else "(Пустой документ)",
                    encoding="utf-8"
                )

                return {
                    "status": "ok" if (text_md or "").strip() else "empty",
                    "mode": "doc",
                    "language": "unk",
                    "segments": 0,
                    "lecture_type": lecture_type,
                    "artifacts": {"doc_md": str((out_dir / "document.md").resolve())},
                    "doc_preview": (text_md[:800] if text_md else ""),
                }

            except Exception as e:
                (out_dir / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
                return {"status": "error", "message": str(e)}

        # ---- ФОРМАТ НЕ ПОДДЕРЖАН ----
        return {"status": "error", "message": "Неподдерживаемый формат. Ожидается аудио, видео, документ, презентация или web URL."}

    except Exception as e:
        (out_dir / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
        return {"status": "error", "message": str(e)}

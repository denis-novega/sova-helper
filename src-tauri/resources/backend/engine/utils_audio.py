from pathlib import Path
import subprocess, os
import webrtcvad
import numpy as np
import soundfile as sf

def ffmpeg_ensure_wav_16k_mono(src: Path, dst: Path) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg","-y","-i", str(src), "-ac","1","-ar","16000","-vn", str(dst)]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dst

def read_wav_bytes(path: Path):
    data, sr = sf.read(str(path))
    if sr != 16000: raise ValueError("ожидался WAV 16kHz")
    if data.ndim > 1: data = data[:,0]
    data_i16 = (np.clip(data, -1, 1) * 32767).astype(np.int16).tobytes()
    return data_i16, sr

def vad_trim(wav16k_path: Path, aggressiveness: int = 2, frame_ms: int = 30) -> Path:
    """WebRTC VAD; если после обрезки < 3 сек — возвращаем исходник (музыка/шум)."""
    vad = webrtcvad.Vad(aggressiveness)
    raw, sr = read_wav_bytes(wav16k_path)
    frame_bytes = int(sr * frame_ms / 1000) * 2
    voiced = bytearray()
    for i in range(0, len(raw), frame_bytes):
        frame = raw[i:i+frame_bytes]
        if len(frame) < frame_bytes: break
        if vad.is_speech(frame, sr):
            voiced.extend(frame)
    seconds = len(voiced) / (2 * sr)
    if seconds < 3.0:
        # слишком мало речи — не режем вовсе
        return wav16k_path
    out = wav16k_path.with_name(wav16k_path.stem + "_vad.wav")
    arr = np.frombuffer(bytes(voiced), dtype=np.int16).astype(np.float32)/32767.0
    sf.write(str(out), arr, sr)
    return out

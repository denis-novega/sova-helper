# engine/ytdlp_utils.py
from __future__ import annotations

import io
import re
import uuid
from pathlib import Path
from typing import Optional, Dict, Any

import requests
import trafilatura
from yt_dlp import YoutubeDL


# =========================
# helpers
# =========================

def sanitize_filename(name: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", name or "")
    name = name.strip(" ._")
    if not name:
        name = uuid.uuid4().hex
    return name[:200]


def _http_get(url: str, timeout: int = 25, stream: bool = False) -> requests.Response:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SovaBot/1.0)"
    }
    r = requests.get(url, timeout=timeout, headers=headers, allow_redirects=True, stream=stream)
    return r


# =========================
# Google Docs / Drive
# =========================

_GDOC_RX = re.compile(r"https?://docs\.google\.com/document/d/([a-zA-Z0-9\-_]+)", re.I)
_GDRIVE_FILE_RX = re.compile(r"https?://drive\.google\.com/file/d/([a-zA-Z0-9\-_]+)", re.I)
_GDRIVE_OPEN_RX = re.compile(r"https?://drive\.google\.com/open\?id=([a-zA-Z0-9\-_]+)", re.I)

def extract_gdoc_id(url: str) -> Optional[str]:
    m = _GDOC_RX.search(url or "")
    return m.group(1) if m else None

def extract_drive_id(url: str) -> Optional[str]:
    for rx in (_GDRIVE_FILE_RX, _GDRIVE_OPEN_RX):
        m = rx.search(url or "")
        if m:
            return m.group(1)
    return None


def fetch_gdoc_as_txt(url: str, out_dir: Path) -> Path:
    """Google Docs → .txt (public/share link must allow export)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    doc_id = extract_gdoc_id(url)
    if not doc_id:
        raise ValueError("Некорректная ссылка на Google Docs (ожидался /document/d/<id>)")
    export_url = f"https://docs.google.com/document/d/{doc_id}/export?format=txt"
    r = _http_get(export_url)
    if r.status_code != 200:
        raise RuntimeError(f"Google Docs недоступен (HTTP {r.status_code}). Проверьте доступ 'по ссылке'.")
    fname = sanitize_filename(doc_id) or f"gdoc-{uuid.uuid4().hex}"
    fp = out_dir / f"{fname}.txt"
    fp.write_bytes(r.content)
    return fp


def fetch_gdoc_as_docx(url: str, out_dir: Path) -> Path:
    """Google Docs → .docx (если нужно сохранить форматирование)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    doc_id = extract_gdoc_id(url)
    if not doc_id:
        raise ValueError("Некорректная ссылка на Google Docs (ожидался /document/d/<id>)")
    export_url = f"https://docs.google.com/document/d/{doc_id}/export?format=docx"
    r = _http_get(export_url)
    if r.status_code != 200:
        raise RuntimeError(f"Google Docs недоступен (HTTP {r.status_code}). Проверьте доступ 'по ссылке'.")
    fname = sanitize_filename(doc_id) or f"gdoc-{uuid.uuid4().hex}"
    fp = out_dir / f"{fname}.docx"
    fp.write_bytes(r.content)
    return fp


def _gdrive_get_confirm_token(resp_text: str) -> Optional[str]:
    # подтверждение для больших файлов (Google Drive)
    m = re.search(r'href="[^"]*?confirm=([0-9A-Za-z_]+)[^"]*"', resp_text)
    if m:
        return m.group(1)
    return None


def fetch_drive_file(url: str, out_dir: Path) -> Path:
    """
    Google Drive → оригинальный файл (поддержка больших файлов с confirm-token).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    file_id = extract_drive_id(url)
    if not file_id:
        raise ValueError("Некорректная ссылка на Google Drive (ожидался /file/d/<id> или open?id=<id>)")

    # первый запрос
    sess = requests.Session()
    base = f"https://drive.google.com/uc?export=download&id={file_id}"
    r1 = sess.get(base, headers={"User-Agent": "Mozilla/5.0"}, allow_redirects=True)
    if r1.status_code != 200:
        raise RuntimeError(f"Google Drive недоступен (HTTP {r1.status_code}).")

    token = _gdrive_get_confirm_token(r1.text)
    if token:
        r = sess.get(f"{base}&confirm={token}", headers={"User-Agent": "Mozilla/5.0"}, allow_redirects=True, stream=True)
    else:
        r = sess.get(base, headers={"User-Agent": "Mozilla/5.0"}, allow_redirects=True, stream=True)

    if r.status_code != 200:
        raise RuntimeError(f"Google Drive download error (HTTP {r.status_code}).")

    disp = r.headers.get("Content-Disposition", "")
    m = re.search(r'filename="?(?P<name>[^"]+)"?', disp)
    suggested = m.group("name") if m else f"drive-{file_id}.bin"
    fname = sanitize_filename(suggested) or f"drive-{file_id}.bin"
    fp = out_dir / fname

    with open(fp, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)
    return fp


# =========================
# Generic URL → doc
# =========================

def _infer_ext_from_ct(content_type: str) -> str:
    ct = (content_type or "").lower()
    if "text/plain" in ct:
        return ".txt"
    if "text/markdown" in ct:
        return ".md"
    if "application/pdf" in ct or ct.endswith("/pdf"):
        return ".pdf"
    if "msword" in ct or "officedocument" in ct:
        return ".docx"  # грубо, но лучше, чем .bin
    if "html" in ct:
        return ".html"
    return ".bin"


def fetch_doc_from_url(url: str, out_dir: Path) -> Path:
    """
    Унифицированная загрузка документа по URL:
      - Google Docs → .txt
      - Google Drive → оригинал (включая большие файлы)
      - Обычная веб-страница → чистый текст через trafilatura → web_article.txt
      - Всё остальное → скачиваем «как есть» с расширением из Content-Type
    Возвращаем ПУТЬ к сохранённому файлу (который далее отдаём в process_media).
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1) специальные кейсы
    if extract_gdoc_id(url):
        return fetch_gdoc_as_txt(url, out_dir)
    if extract_drive_id(url):
        return fetch_drive_file(url, out_dir)

    # 2) попробуем распарсить как веб-статью (чистый текст)
    try:
        downloaded = trafilatura.fetch_url(url)
        text = trafilatura.extract(
            downloaded,
            include_comments=False,
            include_tables=False,
            include_links=False,
            no_fallback=True,
            favor_precision=True,
        )
        if not text:
            # Фолбек: прямой запрос и повторная попытка
            r_html = _http_get(url, timeout=25)
            if r_html.status_code == 200:
                text = trafilatura.extract(r_html.text) or ""
        if text and text.strip():
            out = out_dir / "web_article.txt"
            out.write_text(text.strip(), encoding="utf-8")
            return out
    except Exception:
        # молча провалимся к «скачать как есть»
        pass

    # 3) скачать как бинарь «как есть»
    r = _http_get(url, timeout=30, stream=True)
    if r.status_code != 200:
        raise RuntimeError(f"Не удалось скачать документ (HTTP {r.status_code})")

    ext = _infer_ext_from_ct(r.headers.get("Content-Type", ""))
    fname = f"docurl-{uuid.uuid4().hex}{ext}"
    fp = out_dir / fname
    with open(fp, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)
    return fp


# =========================
# YouTube → audio (m4a)
# =========================

def download_youtube_audio(url: str, out_dir: Path) -> Path:
    """
    YouTube → .m4a (нужен ffmpeg в PATH).
    Возвращает путь к итоговому .m4a.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(out_dir / "%(title).200B-%(id)s.%(ext)s")

    # yt-dlp настройки — заточены под стабильную выгрузку m4a
    ydl_opts: Dict[str, Any] = {
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 3,
        "fragment_retries": 3,
        "skip_unavailable_fragments": True,
        "geo_bypass": True,
        "nocheckcertificate": True,
        "http_headers": {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a", "preferredquality": "0"}],
    }

    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        # путь до исходного медиа до постпроцессинга:
        base_media = Path(ydl.prepare_filename(info))
        # итоговый .m4a
        m4a = base_media.with_suffix(".m4a")
        if not m4a.exists():
            vid = info.get("id") or ""
            candidates = list(out_dir.glob(f"*{vid}*.m4a"))
            if candidates:
                m4a = candidates[0]
        if not m4a.exists():
            raise RuntimeError("Не найден итоговый .m4а после yt-dlp/ffmpeg")

        safe = sanitize_filename(m4a.stem) + m4a.suffix
        final_path = m4a.with_name(safe)
        if final_path != m4a:
            m4a.replace(final_path)
        return final_path

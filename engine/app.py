# engine/app.py
from __future__ import annotations

from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from typing import Optional, Dict, Any
from urllib.parse import urlparse
import uuid
import shutil
import traceback

from engine.engine_core import process_media
from engine.ytdlp_utils import download_youtube_audio, fetch_doc_from_url

# 🔹 ИИ-модули: per-source саммари, композитор и мини-чат (локальный RAG)
from engine.ai_summarizer import (
    summarize_source_artifacts,
    save_source_summary,
    compose_final_from_summaries,
)
from engine.chat_rag import chat_answer

app = FastAPI(title="SOVA Engine", version="0.7.3")

BASE = Path("workspace").resolve()
BASE.mkdir(parents=True, exist_ok=True)

# CORS (можно сузить позже под localhost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Раздача артефактов
app.mount("/workspace", StaticFiles(directory=str(BASE), html=False), name="workspace")


@app.get("/")
async def root() -> Dict[str, Any]:
    return {"message": "SOVA Engine is running", "upload_endpoint": "/process"}


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"ok": True})


def _make_artifacts_url(artifacts: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """
    Превращает абсолютные пути артефактов в URL /workspace/...
    Если путь вне BASE — возвращает как есть.
    """
    artifacts = artifacts or {}
    out: Dict[str, str] = {}
    for key, abs_path in artifacts.items():
        try:
            p = Path(str(abs_path)).resolve()
            if BASE in p.parents or p == BASE:
                rel = p.relative_to(BASE)
                out[key] = f"/workspace/{rel.as_posix()}"
            else:
                out[key] = str(p)
        except Exception:
            out[key] = str(abs_path)
    return out


def _clean_url(val: Optional[str]) -> Optional[str]:
    """Убираем кавычки/префиксы [gdoc]/[youtube]/пробелы."""
    if not val:
        return None
    s = val.strip().strip('"').strip("'")
    if s.startswith("[") and "]" in s[:16]:
        s = s[s.index("]") + 1 :].strip()
    return s or None


YOUTUBE_HOSTS = {"youtube.com", "youtu.be", "www.youtube.com", "m.youtube.com"}

def _classify_url(u: str) -> str:
    """Возвращает 'youtube' | 'doc' | '' по домену/строке."""
    try:
        h = (urlparse(u).hostname or "").lower()
        if h in YOUTUBE_HOSTS or "youtube" in h or "youtu.be" in u:
            return "youtube"
        return "doc"
    except Exception:
        return ""


@app.post("/process")
async def process_endpoint(
    request: Request,
    media: Optional[UploadFile] = File(None),
    lecture_type: str = Form("video"),
    youtube_url: Optional[str] = Form(None),
    doc_url: Optional[str] = Form(None),
    url: Optional[str] = Form(None),  # ← для lecture_type=web
) -> JSONResponse:
    """
    Универсальный вход:
    - Веб-источники: lecture_type=web + url
    - Документы: Google Docs / Drive / любой URL (doc_url или url)
    - YouTube: youtube_url
    - Файлы: поле 'media'
    Поддержка: multipart/form-data, x-www-form-urlencoded, application/json, text/plain, query params.
    """
    # ---- Диагностика входа ----
    print("\n=== NEW /process ===")
    print(">>> Incoming headers:", dict(request.headers))
    print(">>> Query params:", dict(request.query_params))
    try:
        ct = request.headers.get("content-type", "")
        if "application/json" in ct or "text/plain" in ct:
            raw = await request.body()
            print(">>> Raw body preview:", raw[:500])
    except Exception as e:
        print(">>> Body preview error:", e)

    # Попытаемся вытащить URL из любых мест
    detected_url: Optional[str] = None
    detected_kind: Optional[str] = None

    # 0) Если сразу пришли нужные поля формы
    if youtube_url or doc_url or url:
        detected_url = _clean_url(youtube_url or doc_url or url)
        if detected_url:
            detected_kind = _classify_url(detected_url)

    # 1) Query-параметры (fallback)
    if not detected_url:
        qp = dict(request.query_params)
        qp_url = (
            qp.get("doc_url") or qp.get("youtube_url") or qp.get("url") or qp.get("link")
            or qp.get("text") or qp.get("q") or qp.get("u") or qp.get("source") or qp.get("input")
        )
        if isinstance(qp_url, str) and qp_url.strip():
            detected_url = _clean_url(qp_url)
            if detected_url:
                detected_kind = _classify_url(detected_url)

    # 2) multipart/x-www-form-data или x-www-form-urlencoded
    if not detected_url:
        try:
            form = await request.form()
            form_dict = {}
            for k, v in form.multi_items():
                form_dict[k] = v.filename if isinstance(v, UploadFile) else v
            print(">>> FORM KEYS:", list(form.keys()))
            print(">>> FORM FULL:", form_dict)

            lecture_type = form.get("lecture_type") or lecture_type

            for k in ["doc_url", "youtube_url", "url", "link", "text", "q", "u", "source", "input"]:
                val = form.get(k)
                if isinstance(val, str) and val.strip():
                    detected_url = _clean_url(val)
                    if detected_url:
                        detected_kind = _classify_url(detected_url)
                        break

            if not detected_url:
                for k, v in form.multi_items():
                    if isinstance(v, str) and v.strip().lower().startswith(("http://", "https://")):
                        detected_url = _clean_url(v)
                        if detected_url:
                            detected_kind = _classify_url(detected_url)
                            break

            if media is None and "media" in form:
                maybe_file = form.get("media")
                if isinstance(maybe_file, UploadFile):
                    media = maybe_file
        except Exception as e:
            print(">>> form parse error:", e)

    # 3) application/json
    if not detected_url and "application/json" in (request.headers.get("content-type") or ""):
        try:
            data = await request.json()
            print(">>> JSON:", data)
            if isinstance(data, dict):
                lecture_type = data.get("lecture_type") or lecture_type
                for k in ["doc_url", "youtube_url", "url", "link", "text", "q", "u", "source", "input"]:
                    val = data.get(k)
                    if isinstance(val, str) and val.strip():
                        detected_url = _clean_url(val)
                        if detected_url:
                            detected_kind = _classify_url(detected_url)
                            break
                if not detected_url:
                    for container in ("data", "payload", "body"):
                        inner = data.get(container)
                        if isinstance(inner, dict):
                            for k in ["doc_url", "youtube_url", "url", "link", "text", "q", "u", "source", "input"]:
                                val = inner.get(k)
                                if isinstance(val, str) and val.strip():
                                    detected_url = _clean_url(val)
                                    if detected_url:
                                        detected_kind = _classify_url(detected_url)
                                        break
                            if detected_url:
                                break
        except Exception as e:
            print(">>> JSON parse error:", e)

    # 4) text/plain (просто строка-URL)
    if not detected_url and "text/plain" in (request.headers.get("content-type") or ""):
        try:
            raw = (await request.body()).decode("utf-8", errors="ignore").strip()
            if raw:
                detected_url = _clean_url(raw)
                if detected_url:
                    detected_kind = _classify_url(detected_url)
        except Exception as e:
            print(">>> text/plain read error:", e)

    # --- Создаём job директорию ---
    job_id = str(uuid.uuid4())[:8]
    job_dir = BASE / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    # ==== РАННЯЯ ВЕТКА ДЛЯ WEB (lecture_type=web) ====
    if (lecture_type or "").lower() == "web":
        url_val = _clean_url(url) or _clean_url(doc_url) or _clean_url(youtube_url) or detected_url
        if not (url_val and url_val.strip()):
            return JSONResponse(
                {"status": "error", "message": "Для lecture_type=web требуется поле url"},
                status_code=400,
            )

        # сохраняем url.txt — engine_core возьмёт оттуда
        url_txt = job_dir / "url.txt"
        url_txt.write_text(url_val.strip(), encoding="utf-8")

        res = process_media(url_txt, job_dir, lecture_type)

        # 🔹 Гарантируем наличие doc_preview (для фронта) и doc_md_inline (для панели «Текст»)
        text = (res.get("text") or res.get("doc_preview") or "").strip()

        artifacts_dict = dict(res.get("artifacts") or {})
        if text and "doc_md_inline" not in artifacts_dict:
            artifacts_dict["doc_md_inline"] = text

        artifacts_url = _make_artifacts_url(artifacts_dict)

        payload = dict(res or {})
        payload.update(
            {
                "job_id": job_id,
                "source": {"type": "web", "url": url_val, "path": str(url_txt.resolve())},
                "artifacts": artifacts_dict,
                "artifacts_url": artifacts_url,
                "doc_preview": text,
            }
        )
        if not payload.get("message") and payload.get("status") == "error":
            payload["message"] = "Ошибка при обработке веб-страницы"

        return JSONResponse(payload)

    # ==== DOC-URL (не web-режим, а просто документ по ссылке) ====
    if detected_url and detected_kind == "doc":
        try:
            doc_path = fetch_doc_from_url(detected_url, job_dir)
            res = process_media(doc_path, job_dir, lecture_type)
            artifacts_url = _make_artifacts_url(res.get("artifacts"))
            payload = dict(res or {})
            if not payload.get("message") and payload.get("status") == "error":
                payload["message"] = "Ошибка обработки документа"
            payload.update(
                {
                    "status": payload.get("status", "ok"),
                    "job_id": job_id,
                    "source": {"type": "doc_url", "url": detected_url, "path": str(doc_path.resolve())},
                    "artifacts_url": artifacts_url,
                }
            )
            return JSONResponse(payload)
        except Exception as e:
            tb = traceback.format_exc()
            return JSONResponse(
                {
                    "status": "error",
                    "stage": "doc_download_or_process",
                    "message": f"Ошибка скачивания/обработки документа: {e}",
                    "trace": tb,
                    "debug_echo": {"detected_url": detected_url, "lecture_type": lecture_type},
                },
                status_code=400,
            )

    # ==== YOUTUBE ====
    if detected_url and detected_kind == "youtube":
        try:
            audio_path = download_youtube_audio(detected_url, job_dir)
            res = process_media(audio_path, job_dir, lecture_type)
            artifacts_url = _make_artifacts_url(res.get("artifacts"))
            payload = dict(res or {})
            if not payload.get("message") and payload.get("status") == "error":
                payload["message"] = "Ошибка обработки YouTube"
            payload.update(
                {
                    "status": payload.get("status", "ok"),
                    "job_id": job_id,
                    "source": {"type": "youtube", "url": detected_url, "path": str(Path(audio_path).resolve())},
                    "artifacts_url": artifacts_url,
                }
            )
            return JSONResponse(payload)
        except Exception as e:
            tb = traceback.format_exc()
            return JSONResponse(
                {
                    "status": "error",
                    "stage": "youtube_download_or_process",
                    "message": f"Ошибка скачивания/обработки YouTube: {e}",
                    "trace": tb,
                    "debug_echo": {"detected_url": detected_url, "lecture_type": lecture_type},
                },
                status_code=400,
            )

    # ==== FILE UPLOAD ====
    if media is not None:
        try:
            in_path = job_dir / media.filename
            with in_path.open("wb") as f:
                shutil.copyfileobj(media.file, f)
            res = process_media(in_path, job_dir, lecture_type)
            artifacts_url = _make_artifacts_url(res.get("artifacts"))
            payload = dict(res or {})
            if not payload.get("message") and payload.get("status") == "error":
                payload["message"] = "Ошибка обработки файла"
            payload.update(
                {
                    "status": payload.get("status", "ok"),
                    "job_id": job_id,
                    "source": {"type": "upload", "path": str(in_path.resolve())},
                    "artifacts_url": artifacts_url,
                }
            )
            return JSONResponse(payload)
        except Exception as e:
            tb = traceback.format_exc()
            return JSONResponse(
                {
                    "status": "error",
                    "stage": "upload_or_process",
                    "message": f"Ошибка обработки загруженного файла: {e}",
                    "trace": tb,
                    "debug_echo": {"filename": getattr(media, 'filename', None), "lecture_type": lecture_type},
                },
                status_code=400,
            )

    # ==== Ничего не нашли: подробный дамп для отладки ====
    body_preview = ""
    try:
        raw = (await request.body())[:800]
        body_preview = raw.decode("utf-8", errors="ignore")
    except Exception:
        pass

    form_keys, form_dump = [], {}
    try:
        form = await request.form()
        form_keys = list(form.keys())
        form_dump = {k: (v.filename if isinstance(v, UploadFile) else v) for k, v in form.multi_items()}
    except Exception as e:
        form_dump = {"form_read_error": str(e)}

    return JSONResponse(
        {
            "status": "error",
            "message": "Передайте файл (media) или youtube_url или doc_url или (lecture_type=web + url)",
            "debug": {
                "headers": dict(request.headers),
                "query_params": dict(request.query_params),
                "form_keys": form_keys,
                "form_dump": form_dump,
                "body_preview": body_preview[:500],
            },
        },
        status_code=400,
    )


# =========================
#     НОВЫЕ ЭНДПОИНТЫ
# =========================

@app.post("/summarize_source")
async def summarize_source_endpoint(payload: Dict[str, Any]) -> JSONResponse:
    """
    body:
    {
      "job_id": "<id>",
      "name": "Human label (например: web_guardian)",
      "artifacts": { "doc_md": "/abs/path/to/document.md", "json": "...", "vtt": "..." },
      "model": "mistral"    # опционально
    }
    """
    job_id = payload.get("job_id")
    artifacts = payload.get("artifacts") or {}
    name = payload.get("name") or "source"
    model = payload.get("model") or "mistral"

    if not (job_id and isinstance(artifacts, dict)):
        return JSONResponse({"status": "error", "message": "job_id и artifacts обязательны"}, status_code=400)

    workdir = BASE / job_id
    try:
        md = summarize_source_artifacts(artifacts, model=model)
        p = save_source_summary(workdir, name, md)  # -> Path, файл внутри workspace/<job_id>/summaries/*.md

        # добавляем удобные поля для фронта:
        rel = p.resolve().relative_to(BASE).as_posix()  # <job_id>/summaries/xxx.md
        return JSONResponse({
            "status": "ok",
            "summary_path": str(p.resolve()),          # абсолютный путь (как было)
            "summary_rel": f"/workspace/{rel}",        # ✅ готовый URL для <fetch>
            "summary_name": p.name,                    # имя файла (xxx.md)
        })
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=400)


@app.post("/compose_final")
async def compose_final_endpoint(payload: Dict[str, Any]) -> JSONResponse:
    """
    body: { "job_id": "<id>", "model": "mistral" }
    """
    job_id = payload.get("job_id")
    model = payload.get("model") or "mistral"
    if not job_id:
        return JSONResponse({"status": "error", "message": "job_id обязателен"}, status_code=400)
    workdir = BASE / job_id
    try:
        final_md = compose_final_from_summaries(workdir, model=model)
        path = (workdir / "final_compiled.md").resolve()
        rel = path.relative_to(BASE).as_posix()
        return JSONResponse({
            "status": "ok",
            "final_md_path": str(path),
            "final_md_rel": f"/workspace/{rel}",   # ✅ удобный URL
            "preview": final_md[:1200]
        })
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=400)


@app.post("/chat")
async def chat_endpoint(payload: Dict[str, Any]) -> JSONResponse:
    """
    body: { "job_id": "<id>", "query": "вопрос", "mode": "summary|full|auto", "top_k": 6, "model": "mistral" }
    """
    job_id = payload.get("job_id")
    query = (payload.get("query") or "").strip()
    mode = payload.get("mode") or "auto"
    top_k = int(payload.get("top_k") or 6)
    model = payload.get("model") or "mistral"

    if not (job_id and query):
        return JSONResponse({"status": "error", "message": "job_id и query обязательны"}, status_code=400)

    workdir = BASE / job_id
    try:
        res = chat_answer(workdir, query=query, mode=mode, top_k=top_k, model=model)
        return JSONResponse({"status": "ok", **res})
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=400)


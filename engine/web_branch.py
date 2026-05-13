# engine/web_branch.py
from __future__ import annotations
from pathlib import Path
from typing import Dict, Any, Optional
import json
import traceback
from urllib.parse import urlparse

import requests
import trafilatura

# Доп. fallback'и
from bs4 import BeautifulSoup  # type: ignore
from readability import Document  # type: ignore


DEFAULT_HEADERS_CHAIN = [
    # обычный десктоп
    {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/123.0 Safari/537.36 SOVA/1.0"},
    # firefox
    {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0 SOVA/1.0"},
    # мобильный
    {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
                   "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1 SOVA/1.0"},
]


def _http_get_resilient(url: str, timeout: int = 25) -> Optional[str]:
    """
    Пытаемся скачать HTML, пробуя несколько UA.
    Возвращает html (str) или None.
    """
    for hdrs in DEFAULT_HEADERS_CHAIN:
        try:
            r = requests.get(url, headers=hdrs, timeout=timeout, allow_redirects=True)
            # некоторые сайты возвращают 4xx, но с полезным телом — проверим всё равно
            if r.status_code >= 200 and r.status_code < 400 and (r.text or "").strip():
                return r.text
            # последний шанс — если тело есть, отдаём его, даже при 4xx (нередко Guardian/TheEconomist отдают весь текст)
            if (r.text or "").strip():
                return r.text
        except Exception:
            # пробуем следующий user-agent
            continue
    return None


def _extract_with_trafilatura(html: Optional[str], url: str) -> str:
    """
    Пытаемся извлечь текст через trafilatura.
    Сначала из html (если он есть), затем fetch_url(url) при провале.
    """
    text = ""
    if html:
        text = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=False,
            include_links=False,
            no_fallback=True,
            favor_precision=True,
        ) or ""
    if not text:
        # «второй проход»: пусть trafilatura сама скачает и извлечёт
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(downloaded) or ""
    return text or ""


def _extract_with_readability(html: Optional[str]) -> str:
    """
    Fallback: Readability -> чистый текст (через BeautifulSoup для удаления тегов).
    """
    if not html:
        return ""
    try:
        doc = Document(html)
        summary_html = doc.summary(html_partial=True)
        if not summary_html:
            return ""
        soup = BeautifulSoup(summary_html, "lxml")
        # убираем скрипты/стили/навигацию
        for bad in soup(["script", "style", "noscript"]):
            bad.decompose()
        # собираем заголовки и параграфы
        parts = []
        for el in soup.find_all(["h1", "h2", "h3", "p", "li"]):
            t = (el.get_text(" ", strip=True) or "").strip()
            if t:
                parts.append(t)
        return "\n".join(parts).strip()
    except Exception:
        return ""


def _extract_with_bs4_plain(html: Optional[str]) -> str:
    """
    Самый простой «шаманский» парсер:
      - Если есть <article> или <main> — берём тексты оттуда,
      - иначе – все <p>, <h1..h3>, <li>
    """
    if not html:
        return ""
    try:
        soup = BeautifulSoup(html, "lxml")
        for bad in soup(["script", "style", "noscript"]):
            bad.decompose()

        scopes = soup.find_all(["article", "main"])
        if scopes:
            candidates = scopes
        else:
            candidates = [soup]

        texts = []
        for sc in candidates:
            for el in sc.find_all(["h1", "h2", "h3", "p", "li"]):
                t = (el.get_text(" ", strip=True) or "").strip()
                if t:
                    texts.append(t)
            if texts:
                break  # если в article/main что-то нашли — достаточно

        if not texts:
            # вообще всё по параграфам
            for el in soup.find_all("p"):
                t = (el.get_text(" ", strip=True) or "").strip()
                if t:
                    texts.append(t)

        return "\n".join(texts).strip()
    except Exception:
        return ""


def process_url(url: str, workdir: Path) -> Dict[str, Any]:
    """
    Качает и анализирует веб-страницу (The Economist, Guardian и т.д.)
    Возвращает словарь:
      {
        "status": "ok" | "empty" | "error",
        "text": <str>,
        "meta": {...},
        "artifacts": {"json": "...", "doc_md": "..."}
      }
    """
    workdir.mkdir(parents=True, exist_ok=True)
    log_path = workdir / "error.log"

    try:
        # --- Шаг 1: загрузка HTML c несколькими UA ---
        html = _http_get_resilient(url, timeout=25)

        # сохраняем raw.html для отладки
        raw_html_path = workdir / "raw.html"
        if html:
            raw_html_path.write_text(html, encoding="utf-8", errors="ignore")

        # --- Шаг 2: попытка trafilatura ---
        text = _extract_with_trafilatura(html, url)

        # --- Шаг 3: Readability fallback ---
        if not text:
            rb_text = _extract_with_readability(html)
            # сохраним «readability.html» для дебага (что именно выделила Readability)
            try:
                if html:
                    rb_doc = Document(html)
                    rb_html = rb_doc.summary(html_partial=True) or ""
                    if rb_html:
                        (workdir / "readability.html").write_text(rb_html, encoding="utf-8", errors="ignore")
            except Exception:
                pass
            text = rb_text or text

        # --- Шаг 4: BS4 plain fallback ---
        if not text:
            text = _extract_with_bs4_plain(html)

        # --- Метаданные ---
        domain = urlparse(url).netloc
        meta = {
            "url": url,
            "domain": domain,
            "length": len(text or ""),
        }

        # --- Сохранение артефактов ---
        json_path = workdir / "web_article.json"
        md_path = workdir / "document.md"

        data = {"meta": meta, "text": text}
        json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        md_path.write_text(text or "(Пусто)", encoding="utf-8")

        return {
            "status": "ok" if text else "empty",
            "source_type": "web",
            "meta": meta,
            "text": text,
            "artifacts": {
                "json": str(json_path.resolve()),
                "doc_md": str(md_path.resolve()),
            },
        }

    except Exception as e:
        # подробный стек
        log_path.write_text(traceback.format_exc(), encoding="utf-8")
        return {
            "status": "error",
            "message": f"{e}",
            "source_type": "web",
        }

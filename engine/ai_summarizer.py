# engine/ai_summarizer.py
from __future__ import annotations
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import os
import json
import re
import textwrap
from datetime import datetime

# -------------------------------
# OpenAI SDK (>= 1.0)
# -------------------------------
try:
    from openai import OpenAI
except Exception as e:
    raise RuntimeError(
        "OpenAI SDK is not installed. Install with: pip install openai>=1.0.0"
    ) from e

# -------------------------------
# tiktoken for token counting
# -------------------------------
try:
    import tiktoken
    ENC = tiktoken.get_encoding("cl100k_base")  # suitable for gpt-4o/4.x families
except Exception as e:
    raise RuntimeError(
        "The tiktoken library is not installed. Install with: pip install tiktoken"
    ) from e


# -------------------------------
# Default settings (overridable via env)
# -------------------------------

DEFAULT_MODEL = os.getenv("SOVA_SUMM_MODEL", "gpt-4o-mini")

# Per-chunk source token budget
CHUNK_TOKENS = int(os.getenv("SOVA_SUMM_CHUNK_TOKENS", "2000"))
OVERLAP_TOKENS = int(os.getenv("SOVA_SUMM_OVERLAP_TOKENS", "80"))

# Total source token budget across MAP requests
MAX_TOTAL_MAP_TOKENS = int(os.getenv("SOVA_SUMM_MAX_TOTAL_MAP_TOKENS", "20000"))

# Model output limits (to avoid hidden truncation)
MAP_MAX_TOKENS = int(os.getenv("SOVA_SUMM_MAP_MAX_TOKENS", "1100"))     # per chunk
REDUCE_MAX_TOKENS = int(os.getenv("SOVA_SUMM_REDUCE_MAX_TOKENS", "3000"))  # final

# Reduce batching (input tokens per batch)
REDUCE_BATCH_TOKENS = int(os.getenv("SOVA_SUMM_REDUCE_BATCH_TOKENS", "4500"))

# Save sidecar JSON next to .md; if False — only return markdown
SAVE_SIDECAR_JSON = os.getenv("SOVA_SUMM_SAVE_JSON", "1") == "1"

# Optional logging to file
LOG_PATH = Path(os.getenv("SOVA_SUMM_LOG", "")).expanduser() if os.getenv("SOVA_SUMM_LOG") else None


# -------------------------------
# Logger
# -------------------------------

def _log(msg: str):
    line = f"[{datetime.utcnow().isoformat(timespec='seconds')}Z] {msg}"
    if LOG_PATH:
        try:
            LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with LOG_PATH.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass
    # print(line)  # enable for debugging if needed


# -------------------------------
# Token counting
# -------------------------------

def _ntokens(s: str) -> int:
    return len(ENC.encode(s or ""))


# -------------------------------
# OpenAI client
# -------------------------------

def _mk_client() -> OpenAI:
    # API key is taken from OPENAI_API_KEY
    return OpenAI()


def _chat_complete(
    model: str,
    system: str,
    user: str,
    *,
    temperature: float = 0.2,
    timeout: int = 60,
    max_tokens: int = 800
) -> Tuple[str, Optional[str]]:
    client = _mk_client()
    resp = client.chat.completions.create(
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        timeout=timeout,
    )
    content = (resp.choices[0].message.content or "").strip()
    finish = getattr(resp.choices[0], "finish_reason", None)
    if finish and finish != "stop":
        _log(f"[WARN] finish_reason={finish} (max_tokens={max_tokens}) -> possible truncation")
    return content, finish


def _normalize_model_name(model: str | None) -> str:
    m = (model or "").strip().lower()
    if not m.startswith("gpt-"):
        return DEFAULT_MODEL
    return model  # already a valid OpenAI model name


# -------------------------------
# Read & clean source text
# (PDFs are NOT read — provide .txt/.md/.json/.vtt)
# -------------------------------

def _read_text_any(p: Path) -> str:
    if not p.exists():
        return ""
    ext = p.suffix.lower()
    if ext in {".md", ".txt", ".vtt"}:
        return p.read_text(encoding="utf-8", errors="ignore")
    if ext == ".json":
        try:
            j = json.loads(p.read_text(encoding="utf-8", errors="ignore"))
            # transcript.json → stitch segments
            if isinstance(j, dict) and "segments" in j and isinstance(j["segments"], list):
                return "\n".join(
                    [(s.get("text") or "").strip() for s in j["segments"] if (s.get("text") or "").strip()]
                )
            # web_article.json → text
            if isinstance(j, dict) and "text" in j:
                return j.get("text") or ""
            return json.dumps(j, ensure_ascii=False, indent=2)
        except Exception:
            return ""
    return ""


_VTT_TS_RX = re.compile(
    r"^\s*\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}.*$",
    re.MULTILINE,
)
_VTT_HEADER_RX = re.compile(r"^\s*WEBVTT\s*$", re.IGNORECASE | re.MULTILINE)
_MULTI_SPACES_RX = re.compile(r"[ \t]{2,}")
_MULTI_BLANKS_RX = re.compile(r"\n{3,}")


def _clean_text_for_summary(raw: str) -> str:
    """
    Remove WEBVTT header, timestamps, extra blank lines, HTML tags, zero-width chars, etc.
    """
    if not raw:
        return ""
    s = raw
    s = _VTT_HEADER_RX.sub("", s)
    s = _VTT_TS_RX.sub("", s)
    s = re.sub(r"(?m)^\s*\d+\s*$", "", s)  # standalone subtitle numbers
    s = _MULTI_SPACES_RX.sub(" ", s)
    s = _MULTI_BLANKS_RX.sub("\n\n", s)
    s = re.sub(r"</?[^>]+>", "", s)
    s = s.replace("\u200b", "").replace("\ufeff", "")
    return s.strip()


def _split_into_paragraphs(text: str) -> List[str]:
    if not (text or "").strip():
        return []
    parts = re.split(r"\n\s*\n", text)
    parts = [p.strip() for p in parts if p.strip()]
    return parts


# -------------------------------
# Token-based chunking
# -------------------------------

def _greedy_chunk_by_tokens(text: str, max_tokens: int, overlap_tokens: int = 80) -> List[str]:
    """
    Greedily pack paragraphs into chunks to fit max_tokens.
    Add a small overlapping tail from the last paragraph.
    """
    paras = _split_into_paragraphs(text)
    if not paras:
        return []

    chunks: List[str] = []
    buf: List[str] = []
    cur = 0

    for p in paras:
        pt = _ntokens(p) + 2  # account for newlines
        if cur + pt <= max_tokens or not buf:
            buf.append(p)
            cur += pt
        else:
            chunk = "\n\n".join(buf).strip()
            chunks.append(chunk)

            # overlap: keep ~overlap_tokens tail of the last paragraph
            tail = buf[-1]
            while _ntokens(tail) > overlap_tokens and "\n" in tail:
                tail = tail.split("\n", 1)[1]  # drop first line, keep the end

            buf = [tail, p]
            cur = _ntokens(tail) + 2 + pt

    if buf:
        chunks.append("\n\n".join(buf).strip())

    return chunks


def _cap_chunks_by_budget(chunks: List[str], max_total_tokens: int) -> List[str]:
    """
    Keep overall MAP-stage token usage under the budget.
    """
    acc = 0
    kept: List[str] = []
    for ch in chunks:
        t = _ntokens(ch)
        if kept and acc + t > max_total_tokens:
            break
        kept.append(ch)
        acc += t
    return kept


# -------------------------------
# Prompts (MAP/REDUCE separated)
# -------------------------------

# MAP: per-chunk summary — no JSON to save tokens
_SUMMARY_SYSTEM_MAP = (
    "You are an assistant producing a concise, structured summary of a fragment.\n"
    "Requirements:\n"
    "- Be to the point, no fluff.\n"
    "- Structure: Title; Key points (list); Key terms; Short conclusion.\n"
    "- Topics may be a single line, but do NOT add JSON.\n"
    "- Language: same as the source."
)

# REDUCE: final merge — we request JSON at the end and then strip it out
_SUMMARY_SYSTEM_REDUCE = (
    "You are an assistant producing a final concise summary.\n"
    "Requirements:\n"
    "- Be to the point, no fluff.\n"
    "- Structure: Title; Key points (list); Topics (3–7); Key terms; Conclusion.\n"
    "- At the very end add a fenced JSON block (```json ... ```), strictly valid, with fields: "
    "{\"title\": str, \"topics\": [str], \"keywords\": [str], \"summary_bullets\": [str], \"language\": \"auto\"}.\n"
    "- Language: same as the source."
)

_SUMMARY_USER_TMPL = """Source: {title}

Text (fragment):

{content}

Create a short summary according to the rules.
"""

_COMPOSE_SYSTEM = (
    "You are a composer of educational summaries. Input is a set of short summaries (markdown).\n"
    "Assemble a unified summary:\n"
    "- Provide a table of contents\n"
    "- 7–10 main topics with authors/sections\n"
    "- A table: Topic → Thinkers → 1 argument\n"
    "- At the end add a fenced JSON block (```json ... ```) with fields: "
    "{\"topics\": [{\"name\": str, \"authors\": [str], \"one_liner\": str}], \"keywords\": [str]}\n"
    "Keep the style concise and clear. LANGUAGE SAME AS THE SOURCE."
)

_COMPOSE_USER_TMPL = """Below are short summaries (one after another, in markdown):

{summaries_md}

Assemble a single course/lecture summary.
"""


# -------------------------------
# JSON extractor (strip fenced JSON from markdown)
# -------------------------------

_JSON_FENCE_RX = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)

def _extract_json_from_md(md: str) -> Tuple[str, Optional[dict]]:
    """
    Find the first fenced ```json block, parse it, and remove it from markdown.
    Returns (markdown_without_json, dict_or_None).
    """
    m = _JSON_FENCE_RX.search(md or "")
    if not m:
        return md, None
    js_raw = m.group(1)
    md_clean = (_JSON_FENCE_RX.sub("", md)).strip()
    try:
        data = json.loads(js_raw)
    except Exception:
        _log("[WARN] JSON block failed to parse — keeping markdown only")
        return md_clean, None
    return md_clean, data


# -------------------------------
# MAP → REDUCE
# -------------------------------

def _reduce_once(chunks: List[str], title: str, model: str) -> str:
    combined = "\n\n---\n\n".join(chunks)
    user = _SUMMARY_USER_TMPL.format(title=f"{title} — summary (batch)", content=combined)
    out, _ = _chat_complete(
        model,
        _SUMMARY_SYSTEM_REDUCE,  # on reduce we ask for the full structure (with JSON)
        user,
        temperature=0.2,
        timeout=90,
        max_tokens=REDUCE_MAX_TOKENS
    )
    # Immediately strip JSON so the next batch doesn't carry extra tokens
    md, _ = _extract_json_from_md(out)
    return md or out


def _hierarchical_reduce(summaries: List[str], title: str, model: str) -> Tuple[str, Optional[dict]]:
    """
    Hierarchical reduce: compress in portions until one final summary remains.
    On the last step, request JSON and strip it from markdown.
    """
    if not summaries:
        return "", None

    cur = summaries[:]
    # Build batches by total token count ~REDUCE_BATCH_TOKENS
    while len(cur) > 1:
        nxt: List[str] = []
        buf: List[str] = []
        acc = 0
        for s in cur:
            ts = _ntokens(s)
            if acc + ts <= REDUCE_BATCH_TOKENS or not buf:
                buf.append(s)
                acc += ts
            else:
                nxt.append(_reduce_once(buf, title, model))
                buf = [s]
                acc = ts
        if buf:
            nxt.append(_reduce_once(buf, title, model))
        cur = nxt

    # Final pass — request JSON, extract it, return both parts
    final_md_raw = cur[0]
    user = _SUMMARY_USER_TMPL.format(title=f"{title} — final summary", content=final_md_raw)
    out, _ = _chat_complete(
        model,
        _SUMMARY_SYSTEM_REDUCE,
        user,
        temperature=0.2,
        timeout=90,
        max_tokens=REDUCE_MAX_TOKENS
    )
    final_md, final_json = _extract_json_from_md(out)
    return (final_md or out), final_json


# -------------------------------
# Public API
# -------------------------------

def summarize_text(text: str, title: str, model: str = DEFAULT_MODEL) -> str:
    """
    Summarize a single source:
    1) clean text
    2) token-based chunking
    3) cap total tokens for MAP stage
    4) short per-chunk summaries (MAP, no JSON)
    5) hierarchical REDUCE; strip final JSON from markdown
    """
    model = _normalize_model_name(model)
    text = _clean_text_for_summary(text)
    if not (text or "").strip():
        return "(empty source)"

    total_tokens_est = _ntokens(text)
    _log(f"summarize_text: title='{title}', total_tokens_est={total_tokens_est}, model={model}")

    chunks = _greedy_chunk_by_tokens(text, CHUNK_TOKENS, OVERLAP_TOKENS)
    if not chunks:
        chunks = [text]

    # limit the set of chunks by overall MAP token budget
    picks = _cap_chunks_by_budget(chunks, MAX_TOTAL_MAP_TOKENS)
    _log(
        f"summarize_text: chunks_total={len(chunks)}, picked={len(picks)}, "
        f"chunk_tokens={CHUNK_TOKENS}, budget={MAX_TOTAL_MAP_TOKENS}"
    )

    # MAP: short summaries per chunk — WITHOUT JSON
    out_parts: List[str] = []
    for i, ch in enumerate(picks, start=1):
        user = _SUMMARY_USER_TMPL.format(
            title=f"{title} (part {i}/{len(picks)})",
            content=ch,
        )
        try:
            resp, _finish = _chat_complete(
                model,
                _SUMMARY_SYSTEM_MAP,
                user,
                temperature=0.2,
                timeout=60,
                max_tokens=MAP_MAX_TOKENS
            )
        except Exception as e:
            _log(f"[ERR] map pass failed ({i}/{len(picks)}): {e}")
            resp = ""
        out_parts.append((resp or "").strip())

    if not any(out_parts):
        return textwrap.dedent(f"""\
        # {title}
        (failed to generate summary — showing beginning of text)

        {text[:1200]}
        """)

    # REDUCE: hierarchical compression; strip final JSON
    final_md, final_json = _hierarchical_reduce([p for p in out_parts if p], title, model)
    if final_json:
        _log(f"final_json keys: {list(final_json.keys())}")
    return final_md.strip() or "(empty)"


def summarize_source_artifacts(artifacts: Dict[str, str], model: str = DEFAULT_MODEL) -> str:
    """
    Accepts a dict of source artifacts (like the backend provides) → returns a short markdown summary.
    Priority: doc_md > json > vtt
    """
    text = ""
    title = "Source"

    if "doc_md" in artifacts:
        p = Path(artifacts["doc_md"])
        title = p.name
        text = _read_text_any(p)
    elif "json" in artifacts:
        p = Path(artifacts["json"])
        title = p.name
        text = _read_text_any(p)
    elif "vtt" in artifacts:
        p = Path(artifacts["vtt"])
        title = p.name
        text = _read_text_any(p)
    else:
        return "(no text to summarize)"

    _log(f"summarize_source_artifacts: title='{title}', len={len(text)}, tokens_est={_ntokens(text)}")
    return summarize_text(text, title, model=model)


def save_source_summary(workdir: Path, source_name: str, summary_md: str) -> Path:
    """
    Save markdown summary.
    (JSON has already been removed from the text output; save separately in compose if needed.)
    """
    out_dir = workdir / "summaries"
    out_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "_", source_name)[:80] or "src"
    p = out_dir / f"{safe}.md"
    p.write_text(summary_md, encoding="utf-8")
    _log(f"save_source_summary: saved -> {p}")
    return p


def compose_final_from_summaries(workdir: Path, model: str = DEFAULT_MODEL) -> str:
    """
    Collect all *.md from workspace/<job>/summaries → a single compiled summary.
    Also writes the result to <workdir>/final_compiled.md.
    The JSON from the final response is extracted; if SAVE_SIDECAR_JSON=true a sidecar .json is written next to it.
    """
    model = _normalize_model_name(model)

    summ_dir = workdir / "summaries"
    items = sorted(summ_dir.glob("*.md"))
    if not items:
        return "(no source summaries — run summarize_sources first)"

    summaries_md = "\n\n\n".join(
        [f"## {p.stem}\n\n" + p.read_text(encoding="utf-8", errors="ignore") for p in items]
    )
    user = _COMPOSE_USER_TMPL.format(summaries_md=summaries_md)

    _log(f"compose_final_from_summaries: sources={len(items)}, model={model}, tokens_in={_ntokens(summaries_md)}")

    try:
        out, _ = _chat_complete(
            model,
            _COMPOSE_SYSTEM,
            user,
            temperature=0.2,
            timeout=90,
            max_tokens=REDUCE_MAX_TOKENS
        )
    except Exception as e:
        _log(f"[ERR] compose failed: {e}")
        # fallback — simply concatenate
        out = summaries_md

    final_md, final_json = _extract_json_from_md(out)

    out_path = workdir / "final_compiled.md"
    out_path.write_text(final_md, encoding="utf-8")
    _log(f"compose_final_from_summaries: written -> {out_path}")

    if SAVE_SIDECAR_JSON and final_json is not None:
        json_path = workdir / "final_compiled.json"
        json_path.write_text(json.dumps(final_json, ensure_ascii=False, indent=2), encoding="utf-8")
        _log(f"compose_final_from_summaries: sidecar JSON -> {json_path}")

    return final_md

# engine/chat_rag.py
from __future__ import annotations
from typing import Literal
from pathlib import Path

from langchain_community.llms import Ollama
from langchain_core.prompts import PromptTemplate
from .rag_index import build_or_load_index

CHAT_SYSTEM = """Ты — помощник по учебным материалам. Отвечай кратко, точно, ссылайся на источник (id).
Если вопрос на русском — отвечай по-русски; если на английском — по-английски.
Когда просит подробно — приводи цитаты с указанием source_id."""

CHAT_USER_TMPL = """Режим: {mode}

Вопрос:
{query}

Контекст (top-{k} фрагментов):
{context}

Сформируй ответ. Если контекста недостаточно — так и скажи.
"""

def _mk_llm(model: str = "mistral") -> Ollama:
    return Ollama(model=model, temperature=0.2)

def _format_chunks(chunks):
    out = []
    for i, d in enumerate(chunks, start=1):
        sid = d.metadata.get("source_id") or "unknown"
        txt = (d.page_content or "").strip()
        out.append(f"[{i}] ({sid}) {txt[:700]}")
    return "\n\n".join(out)

def chat_answer(workdir: Path, query: str, mode: Literal["summary","full","auto"]="auto", top_k: int = 6, model: str = "mistral"):
    db, _ = build_or_load_index(workdir)

    # фильтр retriever по source_id: summary|final vs full
    if mode == "summary":
        # отдаём предпочтение summary/final
        retriever = db.as_retriever(search_kwargs={"k": top_k, "filter": lambda m: (m.get("source_id","").startswith("summary:") or m.get("source_id")=="final")})
        # NB: filter в FAISS-обёртке не всегда поддержан — fallback: просто k=top_k
        chunks = retriever.get_relevant_documents(query)
    elif mode == "full":
        retriever = db.as_retriever(search_kwargs={"k": top_k})
        chunks = retriever.get_relevant_documents(query)
        # уже на ответе попросим "подробнее"
    else:  # auto
        retriever = db.as_retriever(search_kwargs={"k": top_k})
        chunks = retriever.get_relevant_documents(query)

    ctx = _format_chunks(chunks)
    llm = _mk_llm(model)
    prompt = PromptTemplate.from_template(CHAT_USER_TMPL).format(mode=mode, query=query, k=top_k, context=ctx)
    answer = llm.invoke(f"{CHAT_SYSTEM}\n\n{prompt}")
    return {
        "answer": answer.strip(),
        "chunks": [{"source_id": d.metadata.get("source_id","unknown"), "preview": (d.page_content or "")[:400]} for d in chunks]
    }

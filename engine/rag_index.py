# engine/rag_index.py
from __future__ import annotations
from pathlib import Path
from typing import List, Tuple
import pickle
import glob

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS

EMB_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # лёгкая и быстрая

def _collect_texts(workdir: Path) -> List[Tuple[str, str]]:
    """
    Собираем (source_id, text) из:
      - summaries/*.md  (как "краткие")
      - *.md, web_article.json (как "полные")
    """
    items: List[Tuple[str, str]] = []

    # 1) краткие
    for p in sorted((workdir / "summaries").glob("*.md")):
        try:
            items.append((f"summary:{p.stem}", p.read_text(encoding="utf-8", errors="ignore")))
        except Exception:
            pass

    # 2) финал
    fin = workdir / "final_compiled.md"
    if fin.exists():
        items.append(("final", fin.read_text(encoding="utf-8", errors="ignore")))

    # 3) полнотекст
    for p in sorted(workdir.glob("*.md")):
        if p.name in {"document.md"}:
            items.append((f"doc:{p.stem}", p.read_text(encoding="utf-8", errors="ignore")))

    # web_article.json как fulltext
    wa = workdir / "web_article.json"
    if wa.exists():
        try:
            import json
            j = json.loads(wa.read_text(encoding="utf-8", errors="ignore"))
            if isinstance(j, dict) and j.get("text"):
                items.append(("web_article", j["text"]))
        except Exception:
            pass

    return items

def build_or_load_index(workdir: Path):
    workdir.mkdir(parents=True, exist_ok=True)
    idx_dir = workdir / "rag_index"
    faiss_path = idx_dir / "index.faiss"
    meta_path = idx_dir / "meta.pkl"
    idx_dir.mkdir(parents=True, exist_ok=True)

    embeddings = HuggingFaceEmbeddings(model_name=EMB_MODEL)

    if faiss_path.exists() and meta_path.exists():
        try:
            with open(meta_path, "rb") as f:
                metadocs = pickle.load(f)
            db = FAISS.load_local(str(idx_dir), embeddings, allow_dangerous_deserialization=True)
            return db, metadocs
        except Exception:
            pass

    # строим заново
    items = _collect_texts(workdir)
    if not items:
        # пустой индекс
        from langchain_core.documents import Document
        splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)
        docs = splitter.create_documents(["(нет данных)"])
        db = FAISS.from_documents(docs, embeddings)
        with open(meta_path, "wb") as f:
            pickle.dump([], f)
        db.save_local(str(idx_dir))
        return db, []

    # чанкуем
    from langchain_core.documents import Document
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)
    docs: List[Document] = []
    metadocs = []
    for sid, text in items:
        parts = splitter.create_documents([text])
        for d in parts:
            d.metadata["source_id"] = sid
            docs.append(d)
        metadocs.append({"id": sid, "len": len(text)})

    db = FAISS.from_documents(docs, embeddings)
    with open(meta_path, "wb") as f:
        pickle.dump(metadocs, f)
    db.save_local(str(idx_dir))
    return db, metadocs

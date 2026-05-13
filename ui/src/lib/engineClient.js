// ui/src/lib/engineClient.js
const BASE_URL = import.meta.env.VITE_ENGINE_URL || "http://127.0.0.1:7861";

/* ------------ helpers ------------ */
async function postForm(formData) {
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/process`, {
    method: "POST",
    body: formData,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === "error") {
    const msg = json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function postJson(path, body) {
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === "error") {
    const msg = json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/* ------------ existing exports (leave as is) ------------ */

/** Upload local file (audio/video) */
export async function uploadMedia(file, lectureType = "video") {
  const fd = new FormData();
  fd.append("media", file);
  fd.append("lecture_type", lectureType);
  const res = await postForm(fd);
  return normalizeEngineResponse(res);
}

/** Import by YouTube URL (backend will download m4a audio only) */
export async function processYouTube(youtubeUrl, lectureType = "video") {
  const fd = new FormData();
  fd.append("lecture_type", lectureType);
  fd.append("youtube_url", youtubeUrl);
  const res = await postForm(fd);
  return normalizeEngineResponse(res);
}

/** Normalize engine response to a UI-friendly object */
function normalizeEngineResponse(res) {
  const {
    status,
    mode,
    language,
    segments,
    lecture_type,
    artifacts_url = {},
    artifacts = {},          // ⬅ добавим в нормализацию, может пригодиться
    doc_preview = "",
    job_id,
    source = {},
    debug = {},
  } = res || {};

  const urls = {
    vtt: artifacts_url.vtt || null,
    json: artifacts_url.json || null,
    docMd: artifacts_url.doc_md || null,
    keyFramesJson: artifacts_url.key_frames_json || null,
    ocrJson: artifacts_url.ocr_json || null,
    keyFramesDir: artifacts_url.key_frames_dir || null,
  };

  return {
    ok: status === "ok" || status === "empty",
    empty: status === "empty",
    mode,
    language,
    segments,
    lectureType: lecture_type,
    jobId: job_id,
    source,
    urls,
    preview: doc_preview,
    debug,
    // удобные прямые ссылки для скачивания URL-артефактов
    downloads: {
      vtt: urls.vtt ? `${BASE_URL}${urls.vtt}` : null,
      json: urls.json ? `${BASE_URL}${urls.json}` : null,
      docMd: urls.docMd ? `${BASE_URL}${urls.docMd}` : null,
      keyFramesJson: urls.keyFramesJson ? `${BASE_URL}${urls.keyFramesJson}` : null,
      ocrJson: urls.ocrJson ? `${BASE_URL}${urls.ocrJson}` : null,
      keyFramesDir: urls.keyFramesDir ? `${BASE_URL}${urls.keyFramesDir}` : null,
    },
    // и «сырая» мапа абсолютных путей, если нужно
    artifactsAbs: artifacts,
  };
}

/** Utilities to fetch artifacts via backend relative URLs */
export async function fetchTextViaArtifactsUrl(relativeUrl) {
  if (!relativeUrl) return "";
  const res = await fetch(`${BASE_URL}${relativeUrl}`);
  if (!res.ok) return "";
  return await res.text();
}
export async function fetchJsonViaArtifactsUrl(relativeUrl) {
  if (!relativeUrl) return null;
  const res = await fetch(`${BASE_URL}${relativeUrl}`);
  if (!res.ok) return null;
  return await res.json();
}

/* ------------ new exports for AI endpoints ------------ */

/**
 * Send source to local summarizer (saved to workspace/<job>/summaries/*.md)
 * @param {{jobId:string, name:string, artifactsAbs:object, model?:string}}
 */
export async function summarizeSource({ jobId, name, artifactsAbs, model = "mistral" }) {
  if (!jobId) throw new Error("jobId is required");
  if (!artifactsAbs || typeof artifactsAbs !== "object") throw new Error("artifactsAbs is required");
  return await postJson("/summarize_source", {
    job_id: jobId,
    name: name || "source",
    artifacts: artifactsAbs,   // ВАЖНО: сюда передаём АБСОЛЮТНЫЕ пути
    model,
  });
}

/**
 * Compose the final summary from all summaries/*.md
 * @param {{jobId:string, model?:string}}
 */
export async function composeFinal({ jobId, model = "mistral" }) {
  if (!jobId) throw new Error("jobId is required");
  return await postJson("/compose_final", {
    job_id: jobId,
    model,
  });
}

/**
 * Mini-chat over local RAG index (summary/full/auto)
 * @param {{jobId:string, query:string, mode?:'summary'|'full'|'auto', top_k?:number, model?:string}}
 */
export async function ragChat({ jobId, query, mode = "auto", top_k = 6, model = "mistral" }) {
  if (!jobId) throw new Error("jobId is required");
  if (!query || !query.trim()) throw new Error("query is required");
  return await postJson("/chat", {
    job_id: jobId,
    query,
    mode,
    top_k,
    model,
  });
}

// опционально экспортируем BASE_URL — иногда полезно в UI
export { BASE_URL };

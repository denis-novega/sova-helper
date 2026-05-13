import { useEffect, useMemo, useState } from "react";

/**
 * Fullscreen source viewer (Audio/Video/Slides).
 * Displays: "Segments" and "Text" tabs, search, and artifact download buttons.
 *
 * props:
 * - type: 'audio' | 'video' | 'slides'
 * - artifacts: { vtt?: string, json?: string, doc_md?: string }  // с бэка (artifacts_url) для выбранного источника
 * - title?: string
 * - onBack(): return to editor
 * - engineUrl: string (for example, http://127.0.0.1:7861)
 */
export default function SourceViewer({ type = "audio", artifacts = {}, title, onBack, engineUrl }) {
  const [mode, setMode] = useState("segments"); // 'segments' | 'text'
  const [segments, setSegments] = useState(null); // [{start,end,text}]
  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const base = (engineUrl || "").replace(/\/$/, "");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setErr("");
        let segs = null;

        // 1) пробуем JSON (лучше по качеству)
        if (artifacts.json) {
          const res = await fetch(base + artifacts.json);
          if (!res.ok) throw new Error("JSON fetch failed");
          const data = await res.json();
          if (data && Array.isArray(data.segments)) {
            segs = data.segments.map(s => ({
              start: s.start ?? 0,
              end: s.end ?? 0,
              text: (s.text || "").trim(),
            }));
          }
        }

        // 2) если нет JSON — парсим VTT
        if (!segs && artifacts.vtt) {
          const res = await fetch(base + artifacts.vtt);
          if (!res.ok) throw new Error("VTT fetch failed");
          const txt = await res.text();
          segs = parseVTT(txt);
        }

        // 3) если вообще нет артефактов
        if (!segs) {
          segs = [];
        }

        if (!cancelled) {
          setSegments(segs);
          const text = segs.map(s => s.text).join(" ").trim();
          setRawText(text);
        }
      } catch (e) {
        if (!cancelled) setErr("Failed to load source artifacts.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [artifacts.json, artifacts.vtt, base]);

  const filteredSegments = useMemo(() => {
    if (!segments) return [];
    if (!q) return segments;
    const qq = q.toLowerCase();
    return segments.filter(s => s.text.toLowerCase().includes(qq));
  }, [segments, q]);

  const filteredText = useMemo(() => {
    if (!rawText) return "";
    if (!q) return rawText;
    // простая подсветка
    const parts = rawText.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
    return parts.map((p, i) =>
      p.toLowerCase() === q.toLowerCase()
        ? `<mark>${escapeHtml(p)}</mark>`
        : escapeHtml(p)
    ).join("");
  }, [rawText, q]);

  return (
    <div className="rounded-2xl border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-lg border px-2 py-1 text-sm hover:bg-gray-50">← Back</button>
          <div>
            <div className="text-sm text-gray-500">Source: {labelByType(type)}</div>
            <div className="text-lg font-semibold">{title || "Untitled"}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {artifacts.vtt && (
            <a className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
               href={base + artifacts.vtt} target="_blank" rel="noreferrer">Download VTT</a>
          )}
          {artifacts.json && (
            <a className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
               href={base + artifacts.json} target="_blank" rel="noreferrer">JSON</a>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="inline-flex overflow-hidden rounded-xl border">
          <TabBtn onClick={() => setMode("segments")} active={mode === "segments"}>Segments</TabBtn>
          <TabBtn onClick={() => setMode("text")} active={mode === "text"}>Text</TabBtn>
        </div>

        <div className="flex items-center gap-2">
          <input
            className="w-72 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-600"
            placeholder="Search…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {mode === "text" && (
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => navigator.clipboard.writeText(rawText || "")}
            >
              Copy all
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto p-4">
        {loading && <div className="text-sm text-gray-500">Loading…</div>}
        {!loading && err && <div className="text-sm text-red-600">{err}</div>}

        {!loading && !err && mode === "segments" && (
          <div className="space-y-2">
            {filteredSegments.length === 0 && (
              <div className="text-sm text-gray-500">No segments.</div>
            )}
            {filteredSegments.map((s, idx) => (
              <div key={idx} className="rounded-lg border p-2">
                <div className="mb-1 text-xs text-gray-500">
                  [{fmtTime(s.start)}–{fmtTime(s.end)}]
                </div>
                <div className="text-sm whitespace-pre-wrap">{s.text}</div>
              </div>
            ))}
          </div>
        )}

        {!loading && !err && mode === "text" && (
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: filteredText || "<p class='text-sm text-gray-500'>Empty</p>" }}
          />
        )}
      </div>
    </div>
  );
}

/* helpers */

function TabBtn({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm ${active ? "bg-primary-600 text-white" : "bg-white text-gray-700"} border-r last:border-r-0`}
    >
      {children}
    </button>
  );
}

function labelByType(t) {
  if (t === "audio") return "Audio";
  if (t === "video") return "Video";
  if (t === "slides") return "Slides";
  return t;
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* simple WebVTT parser → [{start,end,text}] */
function parseVTT(vttText) {
  const lines = vttText.split(/\r?\n/);
  const segs = [];
  let buf = [];
  let ts = null;

  function flush() {
    if (!ts) return;
    const [a, b] = ts.split("-->").map(s => s.trim());
    segs.push({
      start: ts2s(a),
      end: ts2s(b),
      text: buf.join(" ").trim(),
    });
    buf = [];
    ts = null;
  }

  for (const ln of lines) {
    if (!ln.trim()) { flush(); continue; }
    if (ln.includes("-->")) { flush(); ts = ln.trim(); continue; }
    if (ln.startsWith("WEBVTT")) continue;
    if (!ts) continue;
    buf.push(ln.trim());
  }
  flush();
  return segs;
}
function ts2s(t) {
  // 00:00:04.000 → seconds
  const m = t.match(/(?:(\d+):)?(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const mi = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  const ms = parseInt(m[4] || "0", 10);
  return h * 3600 + mi * 60 + s + (ms / 1000);
}

export default function LecturesView({ subject, lectures, onBack, onCreate, onRename, onDelete, onOpenEditor }) {
  const isEmpty = lectures.length === 0;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button onClick={onBack} className="rounded-lg border px-2 py-1 hover:bg-gray-50">← Back</button>
          <span>/</span>
          <span>{subject.emoji || "📘"} {subject.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onCreate} className="btn-primary">+ Lecture</button>
        </div>
      </div>

      {isEmpty ? (
        <button
          onClick={onCreate}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-16 text-center text-gray-600 hover:bg-gray-50"
        >
          <div className="text-3xl">📝</div>
          <div className="text-lg font-medium">No lectures yet</div>
          <div className="text-sm text-gray-500">Click to create the first lecture</div>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {lectures.map((l) => (
            <div key={l.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-medium">{l.title}</div>
                  <div className="text-sm text-gray-500">{formatDate(l.date)}{l.duration ? ` • Duration: ${l.duration}` : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={l.status} />
                  <button onClick={() => onRename(l)} className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">✏️</button>
                  <button onClick={() => onDelete(l)} className="rounded-lg border px-2 py-1 text-xs text-red-600 hover:bg-gray-50">🗑️</button>
                  <button onClick={() => onOpenEditor(l)} className="btn-primary">Open</button>
                </div>
              </div>
              {/* progress (visual) */}
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div className={`h-2 rounded-full ${l.status==='processed'?'w-full bg-gray-900': l.status==='processing'?'w-2/3 bg-gray-800':'w-1/4 bg-gray-500'}`}></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }) {
  const map = {
    imported:  { label: "🎙 Imported", cls: "bg-gray-100 text-gray-700" },
    processing:{ label: "⏳ Processing…", cls: "bg-amber-100 text-amber-800" },
    processed: { label: "🧠 Done", cls: "bg-emerald-100 text-emerald-800" },
  }
  const s = map[status] || map.imported
  return <span className={`inline-flex items-center rounded-lg px-2 py-1 text-xs ${s.cls}`}>{s.label}</span>
}

function formatDate(d){ try{ return new Date(d).toLocaleDateString('ru-RU') } catch { return d } }

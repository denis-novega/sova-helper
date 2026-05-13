export default function SubjectsView({ subjects, onOpen, onCreate, onRename, onDelete }) {
  const isEmpty = subjects.length === 0
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Subjects</h1>
          <p className="text-sm text-gray-500">Create subjects and store lectures, audio, and materials in them.</p>
        </div>
        <div className="flex items-center gap-2">
          <input className="w-56 input outline-none focus:ring-2 focus:ring-primary-500" placeholder="Search subject…" />
          <button onClick={onCreate} className="btn-primary">+ Subject</button>
        </div>
      </div>

      {isEmpty ? (
        <button
          onClick={onCreate}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-16 text-center text-gray-600 hover:bg-gray-50"
        >
          <div className="text-3xl">📁</div>
          <div className="text-lg font-medium">No subjects yet</div>
          <div className="text-sm text-gray-500">Click to create the first subject</div>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((s) => {
            const palette = getPalette(s.colorId)
            return (
              <div key={s.id} className={`group card p-4 transition hover:shadow ${palette.card}`}>
                <div className="flex items-start justify-between">
                  <button onClick={() => onOpen(s)} className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{s.emoji || "📘"}</span>
                      <h3 className="text-lg font-semibold hover:underline">{s.name}</h3>
                    </div>
                    <div className="mt-1 text-sm text-gray-600">Updated: {s.updated ?? '—'}</div>
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onRename(s)}
                      className="rounded-lg border px-2 py-1 text-xs text-gray-700 hover:bg-white/70"
                      title="Rename"
                    >✏️</button>
                    <button
                      onClick={() => onDelete(s)}
                      className="rounded-lg border px-2 py-1 text-xs text-red-600 hover:bg-white/70"
                      title="Delete"
                    >🗑️</button>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className={`rounded-lg px-2 py-1 text-xs ${palette.badge}`}>{s.lectures ?? 0} lectures</span>
                </div>
                <div className="mt-3 h-24 rounded-xl border border-dashed bg-white/60" />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function getPalette(id) {
  switch (id) {
    case "emerald": return { card: "bg-emerald-50", badge: "bg-emerald-100 text-emerald-800" }
    case "amber":   return { card: "bg-amber-50",   badge: "bg-amber-100 text-amber-800" }
    case "violet":  return { card: "bg-violet-50",  badge: "bg-violet-100 text-violet-800" }
    case "rose":    return { card: "bg-rose-50",    badge: "bg-rose-100 text-rose-800" }
    case "slate":   return { card: "bg-slate-50",   badge: "bg-slate-100 text-slate-800" }
    default:        return { card: "bg-blue-50",    badge: "bg-blue-100 text-blue-800" }
  }
}

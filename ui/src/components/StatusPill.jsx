export default function StatusPill({ status }) {
  const map = {
    imported: { label: '🎙 Imported', cls: 'bg-gray-100 text-gray-700' },
    processing: { label: '⏳ Processing…', cls: 'bg-amber-100 text-amber-800' },
    processed: { label: '🧠 Done', cls: 'bg-emerald-100 text-emerald-800' },
  }
  const s = map[status] || map.imported
  return <span className={`inline-flex items-center rounded-lg px-2 py-1 text-xs ${s.cls}`}>{s.label}</span>
}

import { useEffect, useState } from "react";

const STATUS_OPTS = [
  { id: "imported",  label: "🎙 Imported" },
  { id: "processing",label: "⏳ Processing…" },
  { id: "processed", label: "🧠 Done" },
];

export default function EditLectureModal({ open, initial, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState("");
  const [status, setStatus] = useState("imported");

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title || "");
    setDate(initial?.date || new Date().toISOString().slice(0,10));
    setDuration(initial?.duration || "");
    setStatus(initial?.status || "imported");
  }, [open, initial]);

  if (!open) return null;

  function submit(e){
    e.preventDefault();
    const t = String(title||"").trim();
    if(!t) return;
    onSave({ title: t, date, duration, status });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold">{initial?.id ? "Edit lecture" : "New lecture"}</h3>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Name</label>
            <input
              value={title}
              onChange={(e)=>setTitle(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="For example: Lecture 01 — Introduction"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-sm text-gray-600">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e)=>setDate(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block text-sm text-gray-600">Duration</label>
              <input
                value={duration}
                onChange={(e)=>setDuration(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="e.g. 42:18"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block text-sm text-gray-600">Status</label>
              <select
                value={status}
                onChange={(e)=>setStatus(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500"
              >
                {STATUS_OPTS.map(o=> <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="input hover:bg-gray-50">Cancel</button>
            <button type="submit" className="btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}

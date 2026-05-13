import { useEffect, useState } from "react";

export default function EditSubjectModal({ open, initial, onClose, onSave }) {
  const emojiSet = ["📘","🧬","📜","🧠","⚙️","🧪","🧮","🌍","💻","🎨","🎼","🧭"];
  const colorSet = [
    { id: "blue",    card: "bg-blue-50",    badge: "bg-blue-100 text-blue-800" },
    { id: "emerald", card: "bg-emerald-50", badge: "bg-emerald-100 text-emerald-800" },
    { id: "amber",   card: "bg-amber-50",   badge: "bg-amber-100 text-amber-800" },
    { id: "violet",  card: "bg-violet-50",  badge: "bg-violet-100 text-violet-800" },
    { id: "rose",    card: "bg-rose-50",    badge: "bg-rose-100 text-rose-800" },
    { id: "slate",   card: "bg-slate-50",   badge: "bg-slate-100 text-slate-800" },
  ];

  // локальный state модалки (то, что видно в превью)
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📘");
  const [colorId, setColorId] = useState("blue");

  // когда модалка открывается или меняется initial — подтягиваем значения
  useEffect(() => {
    if (!open) return;
    setName(initial?.name || "");
    setEmoji(initial?.emoji || "📘");
    setColorId(initial?.colorId || "blue");
  }, [open, initial]);

  if (!open) return null;

  const selected = colorSet.find(c => c.id === colorId) || colorSet[0];

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    onSave({ name: trimmed, emoji, colorId });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold">Configure subject</h3>
        <p className="mt-1 text-sm text-gray-500">Name, icon, and card color.</p>

        {/* Preview — always reflects current state */}
        <div className={`mt-4 card p-4 ${selected.card}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">{emoji}</span>
              <div className="text-lg font-semibold">{name || "New subject"}</div>
            </div>
            <span className={`rounded-lg px-2 py-1 text-xs ${selected.badge}`}>{initial?.lectures ?? 0} lectures</span>
          </div>
          <div className="mt-3 h-16 rounded-xl border border-dashed bg-white/60" />
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="For example: Algebra"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Emoji */}
            <div>
              <label className="mb-1 block text-sm text-gray-600">Icon (emoji)</label>
              <div className="grid grid-cols-8 gap-2">
                {emojiSet.map(e => {
                  const active = e === emoji;
                  return (
                    <button
                      type="button"
                      key={e}
                      onClick={() => setEmoji(e)}
                      className={`flex items-center justify-center rounded-lg border p-2 transition
                        ${active ? "ring-2 ring-primary-600 bg-gray-50" : "hover:bg-gray-50"}`}
                      title={e}
                    >
                      <span className="text-xl">{e}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Color */}
            <div>
              <label className="mb-1 block text-sm text-gray-600">Card color</label>
              <div className="grid grid-cols-6 gap-2">
                {colorSet.map(c => {
                  const active = c.id === colorId;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setColorId(c.id)}
                      className={`h-9 w-full rounded-lg border transition ${c.card} ${active ? "ring-2 ring-primary-600" : ""}`}
                      title={c.id}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="input hover:bg-gray-50">Cancel</button>
            <button type="submit" className="btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

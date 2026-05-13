export default function Topbar({ onHome }) {
  return (
    <header className="sticky top-0 z-30 border-b border-surface-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <button onClick={onHome} className="group inline-flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-600 text-white">
            <span className="text-[10px] font-bold tracking-widest">SOVA</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">SOVA — Smart Lecture Studio</span>
        </button>
        <div className="flex items-center gap-2">
          <button className="btn-ghost">Settings</button>
          <button className="btn-ghost">Help</button>
          {/* You can attach onClick for "create lecture" */}
          <button className="btn-primary">New lecture</button>
        </div>
      </div>
    </header>
  )
}

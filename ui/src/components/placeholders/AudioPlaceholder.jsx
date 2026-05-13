export default function AudioPlaceholder() {
  return (
    <div>
      <div className="mb-2 h-20 w-full rounded-xl border border-dashed bg-gray-50"></div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>audio_placeholder.wav</span>
        <span>01:23</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">▶︎ Play</button>
        <button className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">Replace</button>
      </div>
    </div>
  )
}

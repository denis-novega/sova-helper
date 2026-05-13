export default function VideoPlaceholder() {
  return (
    <div>
        <div className="mb-2 aspect-video w-full overflow-hidden rounded-xl border border-dashed bg-gray-50">
        <div className="flex h-full items-center justify-center text-xs text-gray-400">video_placeholder.mp4 / YouTube link</div>
      </div>
      <div className="flex items-center gap-2">
        <button className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">Open</button>
        <button className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">Replace</button>
      </div>
    </div>
  )
}

export default function PdfPlaceholder() {
  return (
    <div>
      <div className="mb-2 h-32 w-full overflow-hidden rounded-xl border border-dashed bg-gray-50">
        <div className="flex h-full items-center justify-center text-xs text-gray-400">slides_placeholder.pdf / .pptx</div>
      </div>
      <div className="flex items-center gap-2">
        <button className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">View</button>
        <button className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">Replace</button>
      </div>
    </div>
  )
}

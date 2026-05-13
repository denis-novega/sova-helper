export default function AssetCard({ title, children }) {
  return (
    <div className="card p-4">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {children}
    </div>
  )
}

export default function ConfirmModal({ open, title, message, confirmText="Delete", cancelText="Cancel", onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold">{title}</h3>
        {message && <p className="mt-1 text-sm text-gray-500">{message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="input hover:bg-gray-50">{cancelText}</button>
          <button onClick={onConfirm} className="rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">{confirmText}</button>
        </div>
      </div>
    </div>
  )
}

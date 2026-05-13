export function formatDate(d) {
  try { return new Date(d).toLocaleDateString('ru-RU') } catch { return d }
}

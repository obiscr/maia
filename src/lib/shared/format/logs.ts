export function formatLogTs(ts: string | undefined) {
  if (!ts) return "—"
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  const yyyy = d.getFullYear()
  const MM = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const HH = pad(d.getHours())
  const mm = pad(d.getMinutes())
  const ss = pad(d.getSeconds())
  const SSS = pad(d.getMilliseconds(), 3)
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${SSS}`
}

export function levelClass(level: string | undefined) {
  const s = String(level || "").toUpperCase()
  if (s === "ERROR") return "text-destructive"
  if (s === "WARN" || s === "WARNING") return "text-amber-600 dark:text-amber-400"
  if (s === "DEBUG") return "text-violet-600 dark:text-violet-400"
  return "text-sky-600 dark:text-sky-400" // INFO/default
}

export function levelGutterClass(level: string | undefined) {
  const s = String(level || "").toUpperCase()
  if (s === "ERROR") return "bg-destructive"
  if (s === "WARN" || s === "WARNING") return "bg-amber-500"
  if (s === "DEBUG") return "bg-violet-500"
  return "bg-sky-500" // INFO/default
}

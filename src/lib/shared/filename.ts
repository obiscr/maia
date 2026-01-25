export function normalizeFilenameStem(input: string, opts?: { fallback?: string; maxLen?: number }) {
  const fallback = opts?.fallback ?? "file"
  const maxLen = typeof opts?.maxLen === "number" ? opts.maxLen : 120
  const base = String(input ?? "")
    // Windows + macOS reserved/invalid characters
    .replace(/[/\\?%*:|"<>]/g, "-")
    // collapse whitespace
    .replace(/\s+/g, " ")
    .trim()

  const collapsed = base
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")

  const out = (collapsed || fallback).slice(0, Math.max(1, maxLen))
  return out || fallback
}

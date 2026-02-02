export function normalizePublicBaseUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim()
  if (!s) return null

  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }

  const proto = url.protocol.toLowerCase()
  if (proto !== "http:" && proto !== "https:") return null

  // Keep origin + path prefix (supports subpath deployments), but drop query/hash.
  const pathname = String(url.pathname ?? "/")
  const cleanedPath = pathname === "/" ? "" : pathname.replace(/\/+$/, "")
  return `${url.origin}${cleanedPath}`
}

export function joinPublicBaseUrl(base: string, path: string): string {
  const b = String(base ?? "")
    .trim()
    .replace(/\/+$/, "")
  const p = String(path ?? "").trim()

  // If base is missing, fall back to the raw path (caller may choose to skip emails).
  if (!b) return p
  if (!p) return b

  // Disallow absolute URLs for `path` to avoid accidental open-redirect style bugs.
  // `path` is expected to be a relative path like "/reset-password?token=...".
  if (/^https?:\/\//i.test(p)) {
    throw new Error("INVALID_PUBLIC_BASE_URL_PATH")
  }

  if (p.startsWith("/")) return `${b}${p}`
  return `${b}/${p}`
}

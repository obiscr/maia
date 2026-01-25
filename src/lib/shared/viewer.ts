export type ViewerRole = "ADMIN" | "MEMBER"

export type Viewer = {
  publicId: string
  role: ViewerRole
}

const warnedUnknownRoles = new Set<string>()

function warnUnknownRole(raw: unknown) {
  const s = String(raw ?? "").trim()
  if (!s) return
  if (warnedUnknownRoles.has(s)) return
  warnedUnknownRoles.add(s)
  // Best-effort: unknown roles are a data/config bug and should be visible in logs.
  // Warn once per role value to avoid spam.
  console.warn(`[auth] unknown role=${JSON.stringify(s)} (defaulting to MEMBER)`)
}

export function parseViewerRole(role: unknown): ViewerRole | null {
  const s = String(role ?? "")
    .trim()
    .toUpperCase()
  if (s === "ADMIN") return "ADMIN"
  if (s === "MEMBER") return "MEMBER"
  return null
}

export function normalizeRole(role: unknown): ViewerRole {
  const parsed = parseViewerRole(role)
  if (parsed) return parsed
  warnUnknownRole(role)
  return "MEMBER"
}

export function isAdminViewer(viewer: Viewer): boolean {
  return viewer.role === "ADMIN"
}

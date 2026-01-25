export type UrlUpdateKind = "replace" | "push"

function currentPathAndQuery(): string {
  if (typeof window === "undefined") return ""
  return `${window.location.pathname}${window.location.search}`
}

function normalizeNextUrl(nextUrl: string): string {
  const s = String(nextUrl ?? "").trim()
  if (!s) return currentPathAndQuery()
  // Only support same-origin path/query URLs here. (No protocol/host.)
  return s
}

export function updateUrlNoNav(nextUrl: string, kind: UrlUpdateKind = "replace") {
  if (typeof window === "undefined") return
  const url = normalizeNextUrl(nextUrl)
  if (!url) return

  const cur = currentPathAndQuery()
  if (cur === url) return

  const state = window.history.state
  if (kind === "push") window.history.pushState(state, "", url)
  else window.history.replaceState(state, "", url)
}

export function buildPathWithQuery(basePath: string, qp: URLSearchParams) {
  const qs = qp.toString()
  return qs.length ? `${basePath}?${qs}` : basePath
}

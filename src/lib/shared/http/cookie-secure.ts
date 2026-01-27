export type CookieSecureMode = "auto" | "true" | "false"

function normalizeProto(v: string | null | undefined): "http" | "https" | null {
  const s = String(v ?? "")
    .trim()
    .toLowerCase()
  if (s === "https") return "https"
  if (s === "http") return "http"
  return null
}

function readXForwardedProto(headers: Headers): "http" | "https" | null {
  const raw = headers.get("x-forwarded-proto")
  if (!raw) return null
  // e.g. "https" or "https,http"
  const first = raw.split(",")[0]?.trim() ?? ""
  return normalizeProto(first)
}

function readForwardedHeaderProto(headers: Headers): "http" | "https" | null {
  const raw = headers.get("forwarded")
  if (!raw) return null
  // RFC 7239: Forwarded: for=1.2.3.4;proto=https;host=example.com
  // We only care about the first forwarded-element.
  const first = raw.split(",")[0] ?? ""
  const m = first.match(/(?:^|;)\s*proto=([^;]+)/i)
  if (!m) return null
  const v = (m[1] ?? "").trim().replace(/^"|"$/g, "")
  return normalizeProto(v)
}

export function isExternalHttps(params: { headers: Headers; url?: string | null }): boolean {
  const viaXfp = readXForwardedProto(params.headers)
  if (viaXfp) return viaXfp === "https"
  const viaFwd = readForwardedHeaderProto(params.headers)
  if (viaFwd) return viaFwd === "https"
  const url = String(params.url ?? "")
  if (url.startsWith("https://")) return true
  return false
}

export function parseCookieSecureMode(raw: unknown): CookieSecureMode {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
  if (!v) return "true"
  if (v === "auto") return "auto"
  if (v === "1" || v === "true") return "true"
  if (v === "0" || v === "false") return "false"
  return "true"
}

export function shouldSetSecureCookie(params: {
  headers: Headers
  url?: string | null
  mode?: CookieSecureMode | null
}): boolean {
  const mode = parseCookieSecureMode(params.mode ?? process.env.SESSION_COOKIE_SECURE)

  if (mode === "true") return true
  if (mode === "false") return false
  if (mode === "auto") return isExternalHttps({ headers: params.headers, url: params.url })
  return true
}


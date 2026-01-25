// Shared utilities for list-style pages (client-side).
// Keeping these in one place helps enforce consistent behavior across modules.

export function safeReadLocalStorageJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function safeWriteLocalStorageJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

export function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function normalizeAllowedInt<T extends number>(raw: unknown, allowed: readonly T[], fallback: T): T {
  const n = typeof raw === "number" ? raw : Number(raw)
  if (Number.isFinite(n) && allowed.includes(n as T)) return n as T
  return fallback
}

export function isOnlyQueryParamChanged(prevUrl: string, nextUrl: string, param: string) {
  if (!prevUrl) return false
  try {
    const prev = new URLSearchParams(prevUrl.split("?")[1] ?? "")
    const cur = new URLSearchParams(nextUrl.split("?")[1] ?? "")
    prev.delete(param)
    cur.delete(param)
    return prev.toString() === cur.toString()
  } catch {
    return false
  }
}

export function buildPathWithQuery(basePath: string, qp: URLSearchParams) {
  const qs = qp.toString()
  return qs.length ? `${basePath}?${qs}` : basePath
}

/**
 * Consume a one-shot URL param. Returns true when the param existed (and matches value if provided),
 * and deletes it from the provided URLSearchParams.
 */
export function consumeOneShotParam(qp: URLSearchParams, key: string, expectedValue?: string) {
  const v = qp.get(key)
  if (v == null) return false
  if (typeof expectedValue === "string" && v !== expectedValue) return false
  qp.delete(key)
  return true
}

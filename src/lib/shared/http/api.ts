import type { ApiErrorBody, ApiIssue } from "@/lib/shared/http/types"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

export class ApiError extends Error {
  status: number
  code: string
  type?: string
  title?: string
  instance?: string
  issues?: ApiIssue[]
  meta?: Record<string, unknown>
  raw?: unknown

  constructor(params: {
    status: number
    code: string
    message?: string
    type?: string
    title?: string
    instance?: string
    issues?: ApiIssue[]
    meta?: Record<string, unknown>
    raw?: unknown
  }) {
    super(params.message ?? params.code)
    this.name = "ApiError"
    this.status = params.status
    this.code = params.code
    this.type = params.type
    this.title = params.title
    this.instance = params.instance
    this.issues = params.issues
    this.meta = params.meta
    this.raw = params.raw
  }
}

function toApiIssues(x: unknown): ApiIssue[] | undefined {
  if (!Array.isArray(x)) return undefined
  const out: ApiIssue[] = []
  for (const item of x) {
    if (!isPlainObject(item)) continue
    const path = typeof item.path === "string" ? String(item.path) : undefined
    const keyword = typeof item.keyword === "string" ? String(item.keyword) : undefined
    const message = typeof item.message === "string" ? String(item.message) : undefined
    const schemaPath = typeof item.schemaPath === "string" ? String(item.schemaPath) : undefined
    const params = isPlainObject(item.params) ? item.params : undefined
    out.push({ path, keyword, message, schemaPath, params })
  }
  return out.length ? out : undefined
}

async function readJsonOrText(res: Response): Promise<{ json?: unknown; text?: string }> {
  const text = await res.text().catch(() => "")
  if (!text) return {}
  try {
    return { json: JSON.parse(text) }
  } catch {
    return { text }
  }
}

export async function apiFetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  const payload = await readJsonOrText(res)
  if (!res.ok) {
    // Client UX: if auth expires, bounce to login.
    if (res.status === 401 && typeof window !== "undefined") {
      const path = window.location?.pathname ?? ""
      const isAuthPage =
        path === "/signin" ||
        path === "/signup" ||
        path === "/setup" ||
        path === "/otp" ||
        path === "/email-otp" ||
        path === "/magic-link" ||
        path === "/forgot-password" ||
        path === "/reset-password" ||
        path === "/confirm-email" ||
        path === "/auth/magic" ||
        path === "/auth/redirect"
      if (!isAuthPage) {
        try {
          const next = `${window.location.pathname ?? "/"}${window.location.search ?? ""}`
          window.location.assign(`/auth/redirect?next=${encodeURIComponent(next)}`)
        } catch {}
      }
    }

    const j = payload.json
    const body: ApiErrorBody | null = (() => {
      if (!isPlainObject(j)) return null
      if (typeof j.code !== "string") return null
      if (typeof j.status !== "number") return null
      if (typeof j.type !== "string") return null
      if (typeof j.title !== "string") return null
      return {
        type: String(j.type),
        title: String(j.title),
        status: Number(j.status),
        detail: typeof j.detail === "string" ? String(j.detail) : undefined,
        instance: typeof j.instance === "string" ? String(j.instance) : undefined,
        code: String(j.code),
        issues: toApiIssues(j.issues),
        meta: isPlainObject(j.meta) ? j.meta : undefined,
      }
    })()

    if (!body) {
      // Contract: all API errors must be RFC 7807 problem+json.
      throw new ApiError({
        status: res.status,
        code: "HTTP_ERROR",
        message: "Request Failed",
        raw: payload.json ?? payload.text,
      })
    }

    throw new ApiError({
      status: res.status,
      code: body.code,
      message: body.title || body.code,
      type: body.type,
      title: body.title,
      instance: body.instance,
      issues: body.issues,
      meta: body.meta,
      raw: payload.json ?? payload.text,
    })
  }
  return (payload.json ?? {}) as T
}

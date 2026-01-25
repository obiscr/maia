import { NextResponse } from "next/server"

import type { ApiErrorBody, ApiIssue } from "@/lib/shared/http/types"

export function ok<T>(body: T, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: init?.headers })
}

function defaultTitleForStatus(status: number): string {
  if (status === 400) return "Bad Request"
  if (status === 401) return "Unauthorized"
  if (status === 403) return "Forbidden"
  if (status === 404) return "Not Found"
  if (status === 409) return "Conflict"
  if (status === 422) return "Unprocessable Entity"
  if (status === 429) return "Too Many Requests"
  if (status >= 500) return "Internal Server Error"
  return "Request Failed"
}

export function fail(params: {
  status: number
  code: string
  issues?: ApiIssue[]
  meta?: Record<string, unknown>
  headers?: Record<string, string>
  // RFC 7807 optional members (avoid user-facing prose in `detail`; prefer `code` + i18n)
  type?: string
  title?: string
  detail?: string
  instance?: string
}) {
  const code = String(params.code || "").trim() || "HTTP_ERROR"
  const status = params.status
  const type = params.type ?? `urn:maia:problem:${code}`
  const title = params.title ?? defaultTitleForStatus(status)

  const body: ApiErrorBody = {
    type,
    title,
    status,
    ...(params.detail ? { detail: params.detail } : null),
    ...(params.instance ? { instance: params.instance } : null),
    code,
    issues: params.issues,
    meta: params.meta,
  }

  const headers = { ...params.headers, "Content-Type": "application/problem+json" }
  return NextResponse.json(body, { status, headers })
}

export function notFound(code: string = "NOT_FOUND") {
  return fail({ status: 404, code })
}

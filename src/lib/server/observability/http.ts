import "server-only"

import { NextResponse } from "next/server"

import { ensureSqlitePragmas } from "@/lib/server/db"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"
import { fail } from "@/lib/server/http/response"
import {
  endRequestStore,
  runWithRequestStore,
  setRequestAuth,
  type RequestStore,
} from "@/lib/server/observability/request-store"
import { maybeCleanupOperations } from "@/lib/server/operations/cleanup"
import { getAuthedUserFromRequest } from "@/lib/server/auth/session"

function safePath(req: Request) {
  try {
    return new URL(req.url).pathname
  } catch {
    return req.url
  }
}

function toServerTiming(params: { total: number; store: RequestStore }) {
  const parts: string[] = []
  parts.push(`total;dur=${params.total.toFixed(1)}`)
  if (params.store.db.count > 0) {
    parts.push(`db;dur=${params.store.db.totalMs.toFixed(1)}`)
    parts.push(`dbq;desc="queries";dur=${params.store.db.count}`)
    if (params.store.db.slowestMs > 0) parts.push(`dbmax;dur=${params.store.db.slowestMs.toFixed(1)}`)
  }
  for (const m of params.store.marks) {
    const safe = m.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) || "mark"
    parts.push(`${safe};dur=${m.ms.toFixed(1)}`)
  }
  return parts.join(", ")
}

function logLine(params: { req: Request; status: number; total: number; store: RequestStore; error?: unknown }) {
  const method = params.req.method
  const path = safePath(params.req)
  const base = `[http] ${method} ${path} status=${params.status} total=${params.total.toFixed(1)}ms`
  const db = params.store.db.count ? ` db=${params.store.db.totalMs.toFixed(1)}ms q=${params.store.db.count}` : ""
  const err =
    params.error != null ? ` err=${params.error instanceof Error ? params.error.message : String(params.error)}` : ""
  console.info(`${base}${db} rid=${params.store.id}${err}`)
}

export function withApiObservability<TCtx>(
  handler: (req: Request, ctx: TCtx) => Promise<Response>,
  opts?: { jsonErrors?: boolean },
) {
  return async (req: Request, ctx: TCtx) => {
    return await runWithRequestStore(async () => {
      let res: Response | null = null
      try {
        await ensureSqlitePragmas()
        const schemaReady = isCurrentDatabaseSchemaReadySync()
        if (schemaReady) void maybeCleanupOperations()

        // Centralized API auth gate (protects all /api/* routes without editing each handler).
        // Allow auth bootstrap routes + a small allowlist of public-safe endpoints.
        const path = safePath(req)
        const isPublicAllowlisted =
          path === "/api/locale" || // used by the client i18n provider even before login
          path.startsWith("/api/auth/") ||
          // Setup wizard endpoints (must validate installation state themselves).
          path.startsWith("/api/setup/")

        if (path.startsWith("/api/") && !isPublicAllowlisted) {
          if (!schemaReady) return fail({ status: 503, code: "DB_NOT_READY" })
          const user = await getAuthedUserFromRequest(req).catch(() => null)
          if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
          setRequestAuth({ userId: user.id, publicId: user.publicId, role: user.role })
        }

        res = await handler(req, ctx)
      } catch (e) {
        const ended = endRequestStore()
        if (ended) logLine({ req, status: 500, total: ended.total, store: ended.store, error: e })
        if (opts?.jsonErrors === false) throw e
        return fail({ status: 500, code: "INTERNAL_SERVER_ERROR" })
      }

      const ended = endRequestStore()
      if (!ended) return res
      const st = toServerTiming({ total: ended.total, store: ended.store })

      // Try to mutate headers in-place; if that fails, clone Response.
      try {
        res.headers.set("Server-Timing", st)
        res.headers.set("X-Request-Id", ended.store.id)
      } catch {
        const headers = new Headers(res.headers)
        headers.set("Server-Timing", st)
        headers.set("X-Request-Id", ended.store.id)
        res = new NextResponse(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        })
      }

      logLine({ req, status: res.status, total: ended.total, store: ended.store })
      return res
    })
  }
}

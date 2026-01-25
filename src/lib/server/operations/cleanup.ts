import "server-only"

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/server/db"

declare global {
  var __maia_ops_cleanup_inflight: Promise<void> | null | undefined
  var __maia_ops_cleanup_last_at: number | null | undefined
  var __maia_ops_cleanup_last_result:
    | {
        ranAt: number
        durationMs: number
        expiredRunning: number
        deletedIdempotency: number
        deletedOperations: number
        error: string | null
      }
    | null
    | undefined
}

function formatErr(e: unknown) {
  if (e instanceof Error) return e.message || e.name
  return String(e)
}

function envInt(name: string, fallback: number) {
  const raw = process.env[name]
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function daysAgo(days: number) {
  const ms = days * 24 * 60 * 60 * 1000
  return new Date(Date.now() - ms)
}

export function maybeCleanupOperations() {
  const everyMinutes = envInt("OPS_CLEANUP_EVERY_MINUTES", 60) // hourly
  const everyMs = everyMinutes * 60 * 1000
  const now = Date.now()

  const last = globalThis.__maia_ops_cleanup_last_at ?? null
  const inflight = globalThis.__maia_ops_cleanup_inflight ?? null
  if (inflight) return inflight
  if (last != null && now - last < everyMs) return Promise.resolve()

  const p = (async () => {
    const startedAt = Date.now()
    globalThis.__maia_ops_cleanup_last_at = now
    const db = prisma

    const opsTtlDays = envInt("OPS_TTL_DAYS", 30)
    const idemTtlDays = envInt("IDEMPOTENCY_TTL_DAYS", 7)
    const runningMaxAgeDays = envInt("OPS_RUNNING_MAX_AGE_DAYS", 2)
    const errors: string[] = []

    // 1) expire stale RUNNING operations (best-effort) so they don't stay RUNNING forever.
    // Use last activity time (updatedAt) rather than createdAt, so long-running operations that
    // keep reporting progress won't be marked FAILED prematurely.
    const runningCutoff = daysAgo(runningMaxAgeDays)
    let expiredRunning = 0
    try {
      const res = await db.operation.updateMany({
        where: {
          status: "RUNNING",
          updatedAt: { lt: runningCutoff },
        },
        data: {
          status: "FAILED",
          responseStatus: 504,
          responseJson: JSON.stringify({ code: "OPERATION_EXPIRED", meta: { reason: "max_age" } }),
          errorCode: "OPERATION_EXPIRED",
          errorMessage: "Operation expired (max age exceeded)",
          errorJson: JSON.stringify({ message: "Operation expired (max age exceeded)" }),
          completedAt: new Date(),
        },
      })
      expiredRunning = Number(res?.count ?? 0) || 0
    } catch (e) {
      const msg = formatErr(e)
      errors.push(`expire_running:${msg}`)
      console.warn("[ops.cleanup] expire RUNNING failed:", msg)
    }

    // 2) delete old idempotency keys (so clients can’t replay forever).
    const idemCutoff = daysAgo(idemTtlDays)
    let deletedIdempotency = 0
    try {
      const res = await db.idempotencyRecord.deleteMany({
        where: { createdAt: { lt: idemCutoff } },
      })
      deletedIdempotency = Number(res?.count ?? 0) || 0
    } catch (e) {
      const msg = formatErr(e)
      errors.push(`delete_idempotency:${msg}`)
      console.warn("[ops.cleanup] delete idempotency failed:", msg)
    }

    // 3) delete old completed operations (and their idempotency records via FK cascade).
    const opsCutoff = daysAgo(opsTtlDays)
    let deletedOperations = 0
    try {
      const res = await db.operation.deleteMany({
        where: {
          completedAt: { not: null, lt: opsCutoff } satisfies Prisma.DateTimeNullableFilter,
        },
      })
      deletedOperations = Number(res?.count ?? 0) || 0
    } catch (e) {
      const msg = formatErr(e)
      errors.push(`delete_operations:${msg}`)
      console.warn("[ops.cleanup] delete operations failed:", msg)
    }

    globalThis.__maia_ops_cleanup_last_result = {
      ranAt: now,
      durationMs: Date.now() - startedAt,
      expiredRunning,
      deletedIdempotency,
      deletedOperations,
      error: errors.length ? errors.join("; ") : null,
    }
  })().finally(() => {
    globalThis.__maia_ops_cleanup_inflight = null
  })

  globalThis.__maia_ops_cleanup_inflight = p
  return p
}

export function getLastCleanupResult() {
  return globalThis.__maia_ops_cleanup_last_result ?? null
}

export function getCleanupConfig() {
  return {
    everyMinutes: envInt("OPS_CLEANUP_EVERY_MINUTES", 60),
    opsTtlDays: envInt("OPS_TTL_DAYS", 30),
    idempotencyTtlDays: envInt("IDEMPOTENCY_TTL_DAYS", 7),
    runningMaxAgeDays: envInt("OPS_RUNNING_MAX_AGE_DAYS", 2),
  }
}

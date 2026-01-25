import "server-only"

import { maybeCleanupOperations } from "@/lib/server/operations/cleanup"

declare global {
  var __maiaOpsCleanupTimer: NodeJS.Timeout | null | undefined
  var __maiaOpsCleanupToken: symbol | undefined
}

const OPS_CLEANUP_TOKEN = Symbol("maia.ops.cleanup.engine")

function envPositiveInt(name: string, fallback: number) {
  const raw = process.env[name]
  const n = raw == null ? NaN : Number(String(raw).trim())
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/**
 * Best-effort in-process scheduler for ops cleanup.
 *
 * Notes:
 * - Intended for Node runtimes (self-host). In serverless, long-lived timers may not run.
 * - Safe under Next.js dev HMR: we store the timer in globalThis.
 */
export function ensureOpsCleanupEngineRunning() {
  const existing = globalThis.__maiaOpsCleanupTimer ?? null
  if (existing && globalThis.__maiaOpsCleanupToken === OPS_CLEANUP_TOKEN) return
  if (existing) {
    try {
      clearInterval(existing)
    } catch {}
  }

  const tickMs = envPositiveInt("OPS_CLEANUP_ENGINE_TICK_MS", 30_000)
  const timer = setInterval(() => {
    void maybeCleanupOperations().catch(() => {})
  }, tickMs)

  globalThis.__maiaOpsCleanupTimer = timer
  globalThis.__maiaOpsCleanupToken = OPS_CLEANUP_TOKEN

  // Kick once at startup (best-effort).
  void maybeCleanupOperations().catch(() => {})
}

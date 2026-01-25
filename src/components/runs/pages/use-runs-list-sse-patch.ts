"use client"

import type { StreamTopic } from "@/lib/shared/realtime/topics"
import { toCanonicalRunStatus } from "@/lib/shared/run-status"
import { useListSsePatch } from "@/hooks/realtime/use-list-sse-patch"

type RunListSseEvent =
  | { type: "run_status"; runId: string; data: { status?: string } }
  | { type: "run_cancel_requested"; runId: string; data: { cancelRequestedAt?: string | null } }
  | { type: "run_force_stop_requested"; runId: string; data: Record<string, unknown> }

type RunsListCacheRow = {
  id?: string
  publicId?: string
  status?: string
  cancelRequestedAt?: string | null
}

type RunsListCache = Record<string, unknown> & { runs?: RunsListCacheRow[] }

function asRunsListCache(old: unknown): RunsListCache | null {
  if (!old || typeof old !== "object") return null
  return old as RunsListCache
}

export function useRunsListSsePatch(p: { topic: StreamTopic | null; enabled?: boolean }) {
  // Strategy A (SSE → patch cache):
  // - The Runs list updates frequently, and events can reliably identify runId + changed fields, so patching the
  //   list cache is more real-time and avoids extra requests.
  // - Some UI fields are derived and may not be fully inferable from the event payload, so we do throttled
  //   invalidation on key status transitions as a safety net.
  useListSsePatch({
    topic: p.topic,
    enabled: p.enabled !== false && !!p.topic,
    target: { kind: "queries", filters: { queryKey: ["runs"], exact: false } },
    parse: (msg): RunListSseEvent | null => {
      if (!msg || typeof msg !== "object") return null
      const m = msg as Record<string, unknown>
      const type = m.type
      if (typeof type !== "string") return null
      if (type !== "run_status" && type !== "run_cancel_requested" && type !== "run_force_stop_requested") return null

      const d =
        m.data && typeof m.data === "object" ? (m.data as Record<string, unknown>) : ({} as Record<string, unknown>)
      const runId = typeof d.runId === "string" ? String(d.runId) : ""
      if (!runId) return null
      if (type === "run_status")
        return { type, runId, data: { status: typeof d.status === "string" ? String(d.status) : undefined } }
      if (type === "run_cancel_requested")
        return {
          type,
          runId,
          data: {
            cancelRequestedAt:
              d.cancelRequestedAt == null
                ? null
                : typeof d.cancelRequestedAt === "string"
                  ? String(d.cancelRequestedAt)
                  : undefined,
          },
        }
      return { type: "run_force_stop_requested", runId, data: d }
    },
    patch: (old, ev: RunListSseEvent) => {
      const oldObj = asRunsListCache(old)
      const rows: RunsListCacheRow[] = Array.isArray(oldObj?.runs) ? oldObj.runs : []
      if (rows.length === 0) return old
      const idx = rows.findIndex((r) => String(r?.publicId ?? r?.id ?? "") === String(ev.runId))
      if (idx < 0) return old

      const cur = rows[idx] ?? {}
      let next = cur
      if (ev.type === "run_status") {
        const status = typeof ev.data.status === "string" ? String(ev.data.status) : ""
        if (status && status !== cur.status) next = { ...next, status }
      }
      if (ev.type === "run_cancel_requested") {
        const cancelRequestedAt =
          typeof ev.data.cancelRequestedAt === "string" ? String(ev.data.cancelRequestedAt) : null
        if (cancelRequestedAt && cancelRequestedAt !== cur.cancelRequestedAt) next = { ...next, cancelRequestedAt }
      }

      if (next === cur) return old
      const nextRows = rows.slice()
      nextRows[idx] = next
      return oldObj ? { ...oldObj, runs: nextRows } : old
    },
    invalidate: (ev: RunListSseEvent) => {
      if (ev.type !== "run_status") return { kind: "none" as const }
      const status = typeof ev.data.status === "string" ? String(ev.data.status) : ""
      const canon = toCanonicalRunStatus(status)
      const shouldInvalidate =
        canon === "RUNNING" || canon === "SUCCEEDED" || canon === "FAILED" || canon === "CANCELED"
      if (!shouldInvalidate) return { kind: "none" as const }
      return {
        kind: "invalidate" as const,
        filters: { queryKey: ["runs"], exact: false },
        delayMs: 800,
        throttleKey: `runs:${String(ev.runId)}`,
        throttleMs: 5_000,
      }
    },
  })
}

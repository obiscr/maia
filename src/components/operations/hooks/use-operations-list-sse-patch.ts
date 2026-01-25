"use client"

import * as React from "react"
import { type QueryKey } from "@tanstack/react-query"

import type { StreamTopic } from "@/lib/shared/realtime/topics"
import { useListSsePatch } from "@/hooks/realtime/use-list-sse-patch"

type OperationsListCache<RowT> = Record<string, unknown> & { operations?: RowT[] }

function asOperationsListCache<RowT>(old: unknown): OperationsListCache<RowT> | null {
  if (!old || typeof old !== "object") return null
  return old as OperationsListCache<RowT>
}

export function useOperationsListSsePatch<RowT>(p: {
  topic: StreamTopic | null
  /**
   * The active list query key (the one the UI is currently showing).
   * We patch this cache entry in-place (no refetch).
   */
  getActiveQueryKey: () => QueryKey
  /**
   * Returns whether an SSE row should be considered visible under the current filters.
   */
  matchesFilters: (row: RowT) => boolean
  /**
   * Convert raw SSE msg to a row (or null to ignore).
   */
  rowFromSse: (msg: unknown) => { type: string; row: RowT } | null
  /**
   * Whether the list is currently in the "newest view" that supports buffering.
   */
  canBufferNew: boolean
  /**
   * Whether a given create row was already buffered (to dedupe).
   */
  hasPendingId: (id: string) => boolean
  /**
   * Add a row to the pending buffer; returns true if newly added.
   */
  addPending: (row: RowT) => boolean
  /**
   * Update an existing buffered row (progress/completed events may arrive after create was buffered).
   */
  updatePending?: (row: RowT) => void
  /**
   * Increment the cached total count (when a new row is buffered).
   */
  bumpTotal: () => void
}) {
  const { connected } = useListSsePatch({
    topic: p.topic,
    enabled: !!p.topic,
    target: () => ({ kind: "queryKey" as const, queryKey: p.getActiveQueryKey() }),
    parse: (msg) => p.rowFromSse(msg),
    patch: (old, parsed) => {
      if (!parsed) return old
      const type = parsed.type
      const shouldInclude = p.matchesFilters(parsed.row)

      const oldObj = asOperationsListCache<RowT>(old)
      const prev = Array.isArray(oldObj?.operations) ? oldObj.operations : []
      const rowId = (parsed.row as Record<string, unknown> | null)?.["id"]
      const id = typeof rowId === "string" || typeof rowId === "number" ? String(rowId) : ""
      if (!id) return old
      const idx = prev.findIndex((x) => {
        const xid = (x as Record<string, unknown> | null)?.["id"]
        const s = typeof xid === "string" || typeof xid === "number" ? String(xid) : ""
        return s === id
      })

      // Remove if it no longer matches.
      if (idx >= 0 && !shouldInclude) {
        const nextOps = prev.slice()
        nextOps.splice(idx, 1)
        return oldObj ? { ...oldObj, operations: nextOps } : old
      }

      // Update if present.
      if (idx >= 0) {
        const nextOps = prev.slice()
        nextOps[idx] = { ...(nextOps[idx] as object), ...(parsed.row as object) } as RowT
        return oldObj ? { ...oldObj, operations: nextOps } : old
      }

      // New rows: buffer instead of auto-inserting.
      // Rationale:
      // - Auto-inserting a new row can cause view "jumping" (especially when not in newest view, paginating, or filtering).
      // - We buffer creates + bump the total count, and only surface them when the user is in the newest view.
      if (type === "operation_created" && shouldInclude && p.canBufferNew && !p.hasPendingId(id)) {
        const added = p.addPending(parsed.row)
        if (added) p.bumpTotal()
      }

      // If the row is buffered (created event was buffered), we still need to apply later updates
      // (progress/completed). Otherwise, a fast-failing op can be inserted later with stale RUNNING status.
      if (type !== "operation_created" && p.canBufferNew && p.hasPendingId(id)) {
        p.updatePending?.(parsed.row)
      }
      return old
    },
  })

  return { connected }
}

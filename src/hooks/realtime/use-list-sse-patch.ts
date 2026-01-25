"use client"

import * as React from "react"
import { useQueryClient, type QueryFilters, type QueryKey } from "@tanstack/react-query"

import { useTopicStream } from "@/hooks/use-topic-stream"
import type { StreamTopic } from "@/lib/shared/realtime/topics"

export type ListSseTarget = { kind: "queryKey"; queryKey: QueryKey } | { kind: "queries"; filters: QueryFilters }

export type ListSseInvalidateDecision =
  | { kind: "none" }
  | {
      kind: "invalidate"
      filters: QueryFilters
      /** Delay before invalidating (ms). Useful to let a few events coalesce. */
      delayMs?: number
      /** Throttle bucket key. If omitted, a single global bucket is used. */
      throttleKey?: string
      /** Min interval between invalidations in the same bucket (ms). Default: 5000. */
      throttleMs?: number
    }

/**
 * SSE + React Query (list pages): two incremental update strategies.
 *
 * A) SSE → patch React Query cache (more real-time, fewer requests)
 * - Use when: the SSE payload can reliably identify "which row" + "which fields changed", and the list updates often
 *   (full refetch would be noisy/wasteful).
 * - How: patch via `setQueryData/setQueriesData`; if some UI fields are derived/aggregated, do a throttled
 *   `invalidateQueries` as a safety net.
 * - Examples: Runs (`src/components/runs/pages/use-runs-list-sse-patch.ts`), Operations (`useOperationsListSsePatch`).
 *
 * B) SSE → debounce refetch (simpler, more robust)
 * - Use when: there are many event types, many fields/derived fields, filtering/sorting can change row placement,
 *   or SSE does not carry enough information to patch safely.
 * - How: treat SSE as a "dirty" signal; coalesce bursts with `setTimeout(250ms)` and then call `refetch()`.
 * - Examples: Jobs/Batches/Schedules list pages.
 *
 * This is not "inconsistent": the core pattern is still React Query + SSE; the incremental strategy is a
 * deliberate per-surface tradeoff.
 */
export function useListSsePatch<TEvent>(p: {
  topic: StreamTopic | null
  enabled: boolean
  /** Parse/validate message; return null to ignore. */
  parse: (msg: unknown) => TEvent | null
  /** Where to apply patches (single query key or a set of queries). */
  target: ListSseTarget | ((event: TEvent) => ListSseTarget)
  /** Patch function for cached data. Return the same object to keep referential equality. */
  patch: (old: unknown, event: TEvent) => unknown
  /** Optional invalidate policy (for derived fields). */
  invalidate?: (event: TEvent) => ListSseInvalidateDecision
}) {
  const queryClient = useQueryClient()
  const lastInvalidateAtRef = React.useRef<Record<string, number>>({})

  const { connected } = useTopicStream({
    topic: p.topic,
    enabled: p.enabled,
    onMessage: (msg) => {
      const ev = p.parse(msg)
      if (!ev) return
      const target = typeof p.target === "function" ? p.target(ev) : p.target

      if (target.kind === "queryKey") {
        queryClient.setQueryData(target.queryKey, (old) => p.patch(old, ev))
      } else {
        queryClient.setQueriesData(target.filters, (old) => p.patch(old, ev))
      }

      const dec = p.invalidate?.(ev) ?? { kind: "none" }
      if (dec.kind !== "invalidate") return

      const bucket = dec.throttleKey ?? "__global__"
      const now = Date.now()
      const last = Number(lastInvalidateAtRef.current[bucket] ?? 0)
      const throttleMs = typeof dec.throttleMs === "number" ? dec.throttleMs : 5_000
      if (now - last < throttleMs) return
      lastInvalidateAtRef.current[bucket] = now

      const delayMs = typeof dec.delayMs === "number" ? dec.delayMs : 0
      window.setTimeout(() => {
        void queryClient.invalidateQueries(dec.filters)
      }, delayMs)
    },
  })

  return { connected }
}

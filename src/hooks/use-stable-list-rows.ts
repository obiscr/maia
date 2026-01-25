"use client"

import { useEffect, useMemo, useRef } from "react"

import type { ListRow } from "@/components/common/list-row"

/**
 * Keep the last loaded rows visible while a new request is in-flight (prevents "page refresh" feel),
 * and optionally generate placeholder `null` rows for skeleton rendering on the first load.
 */
export function useStableListRows<T>(opts: { rows: T[]; loading: boolean; skeletonCount: number }) {
  const stableRowsRef = useRef<T[]>([])

  useEffect(() => {
    if (!opts.loading) stableRowsRef.current = opts.rows
  }, [opts.loading, opts.rows])

  const shownRows = opts.loading ? stableRowsRef.current : opts.rows

  const listItems = useMemo<Array<ListRow<T>>>(() => {
    if (opts.loading && shownRows.length === 0) return Array.from({ length: opts.skeletonCount }).map(() => null)
    return shownRows as Array<ListRow<T>>
  }, [opts.loading, opts.skeletonCount, shownRows])

  return { stableRowsRef, shownRows, listItems }
}

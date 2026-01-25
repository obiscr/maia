"use client"

import { useQuery, type QueryKey } from "@tanstack/react-query"

export function useListQuery<TData>(p: {
  queryKey: QueryKey
  queryFn: (ctx: { signal?: AbortSignal }) => Promise<TData>
  enabled?: boolean
  staleTimeMs?: number
}) {
  return useQuery<TData>({
    queryKey: p.queryKey,
    enabled: p.enabled ?? true,
    staleTime: typeof p.staleTimeMs === "number" ? p.staleTimeMs : undefined,
    placeholderData: (prev) => prev,
    queryFn: ({ signal }) => p.queryFn({ signal }),
  })
}

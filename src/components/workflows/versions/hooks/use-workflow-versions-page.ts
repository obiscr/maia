"use client"

import * as React from "react"

import { apiFetchJson } from "@/lib/shared/http/api"
import { clampInt, normalizeAllowedInt, safeWriteLocalStorageJson } from "@/hooks/list-page-utils"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { useListQueryState } from "@/hooks/list-query/use-list-query-state"
import { usePageSizePreferenceOnce } from "@/hooks/use-page-size-preference"

export type WorkflowVersionsSortKey = "CREATED_DESC" | "CREATED_ASC"

export type WorkflowVersionsRow = {
  id: string
  version: number
  createdAt: string
  description: string | null
  stepsCount: number
  depsEdgesCount: number
  depsHash: string | null
  depsPackagesCount: number
  envVarsCount: number
  inputSpecConfigured: boolean
  outputsSpecConfigured: boolean
}

const WORKFLOW_VERSIONS_LS_PAGE_SIZE_KEY = "maia.workflowVersions.pageSize.v1"
const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const
type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number]
const DEFAULT_PAGE_SIZE: AllowedPageSize = 20

function normalizePageSize(raw: unknown): AllowedPageSize {
  return normalizeAllowedInt(raw, ALLOWED_PAGE_SIZES, DEFAULT_PAGE_SIZE)
}

export function useWorkflowVersionsPage(p: { workflowId: string }) {
  type State = {
    qDraft: string
    q: string
    sort: WorkflowVersionsSortKey
    pageIndex: number
    pageSize: AllowedPageSize
  }

  const basePath = `/workflows/${p.workflowId}/versions`

  const { state, setState, didInit } = useListQueryState<State>({
    basePath,
    defaults: {
      qDraft: "",
      q: "",
      sort: "CREATED_DESC",
      pageIndex: 0,
      pageSize: DEFAULT_PAGE_SIZE,
    },
    codec: {
      parse: (qp) => {
        const q = qp.get("q")
        const sortRaw = qp.get("sort")
        const pageRaw = qp.get("page")
        const pageSizeRaw = qp.get("pageSize")

        const patch: Partial<State> = {}
        if (typeof q === "string" && q.trim()) {
          patch.qDraft = q
          patch.q = q
        }
        if (sortRaw === "CREATED_ASC" || sortRaw === "CREATED_DESC") patch.sort = sortRaw

        const initialPage = pageRaw ? Number(pageRaw) : 1
        patch.pageIndex = Math.max(0, clampInt(initialPage, 1, 10_000) - 1)

        if (pageSizeRaw != null) patch.pageSize = normalizePageSize(pageSizeRaw)
        return patch
      },
      serialize: (s, qp) => {
        const q = s.q.trim()
        if (q) qp.set("q", q)
        else qp.delete("q")

        if (s.sort !== "CREATED_DESC") qp.set("sort", s.sort)
        else qp.delete("sort")

        if (s.pageIndex > 0) qp.set("page", String(s.pageIndex + 1))
        else qp.delete("page")

        if (s.pageSize !== DEFAULT_PAGE_SIZE) qp.set("pageSize", String(s.pageSize))
        else qp.delete("pageSize")

        return qp
      },
    },
    resetPageIndexDeps: [(s) => s.q, (s) => s.sort, (s) => s.pageSize],
    onResetPageIndex: () => setState((prev) => ({ ...prev, pageIndex: 0 })),
    urlMode: { strategy: "replaceState", kind: "replace" },
  })

  React.useEffect(() => {
    if (!didInit) return
    const tmr = window.setTimeout(() => {
      setState((prev) => {
        if (prev.q === prev.qDraft) return prev
        return { ...prev, q: prev.qDraft }
      })
    }, 250)
    return () => window.clearTimeout(tmr)
  }, [didInit, state.qDraft])

  usePageSizePreferenceOnce<AllowedPageSize>({
    didInit,
    storageKey: WORKFLOW_VERSIONS_LS_PAGE_SIZE_KEY,
    normalize: normalizePageSize,
    getCurrent: () => state.pageSize,
    setNext: (next) => setState((prev) => (prev.pageSize === next ? prev : { ...prev, pageSize: next })),
  })

  React.useEffect(() => {
    if (!didInit) return
    safeWriteLocalStorageJson(WORKFLOW_VERSIONS_LS_PAGE_SIZE_KEY, state.pageSize)
  }, [didInit, state.pageSize])

  const query = useListQuery<{
    workflow: { id: string; name: string }
    versions: WorkflowVersionsRow[]
    total: number
  }>({
    queryKey: [
      "workflowVersions",
      p.workflowId,
      { q: state.q.trim(), sort: state.sort, pageIndex: state.pageIndex, pageSize: state.pageSize },
    ],
    enabled: !!p.workflowId,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      params.set("page", String(state.pageIndex + 1))
      params.set("pageSize", String(state.pageSize))
      params.set("sort", state.sort)
      const q = state.q.trim()
      if (q) params.set("q", q)
      return await apiFetchJson(`/api/workflows/${p.workflowId}/versions?${params.toString()}`, {
        cache: "no-store",
        signal,
      })
    },
  })

  const workflowName = query.data?.workflow?.name ?? ""
  const rows = Array.isArray(query.data?.versions) ? (query.data?.versions as WorkflowVersionsRow[]) : []
  const total = Number(query.data?.total) || 0
  const hasData = !!query.data
  const initialLoading = query.isLoading && !hasData
  const refreshing = query.isFetching && hasData
  const loading = initialLoading
  const loadError = (query.error ?? null) as unknown

  const totalPages = React.useMemo(() => Math.max(1, Math.ceil(total / state.pageSize)), [total, state.pageSize])
  const safePageIndex = React.useMemo(() => Math.min(state.pageIndex, totalPages - 1), [state.pageIndex, totalPages])

  // Clamp page when total/pages changes.
  React.useEffect(() => {
    if (!didInit) return
    if (state.pageIndex !== safePageIndex) setState((prev) => ({ ...prev, pageIndex: safePageIndex }))
  }, [didInit, safePageIndex, state.pageIndex])

  async function refresh() {
    await query.refetch()
  }

  return {
    // data
    workflowName,
    rows,
    total,
    loading,
    refreshing,
    loadError,

    // search
    search: state.qDraft,
    setSearch: (next: string) => setState((prev) => ({ ...prev, qDraft: next })),

    // sort
    sort: state.sort,
    setSort: (next: WorkflowVersionsSortKey) => setState((prev) => ({ ...prev, sort: next })),

    // pagination
    pageIndex: safePageIndex,
    setPageIndex: (n: number) => setState((prev) => ({ ...prev, pageIndex: Math.max(0, Math.floor(n)) })),
    pageSize: state.pageSize,
    setPageSize: (n: number) => setState((prev) => ({ ...prev, pageSize: normalizePageSize(n) })),
    totalPages,
    safePageIndex,

    // actions
    refresh,
  }
}

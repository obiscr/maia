"use client"

import * as React from "react"

import { apiFetchJson } from "@/lib/shared/http/api"
import { clampInt, normalizeAllowedInt, safeWriteLocalStorageJson } from "@/hooks/list-page-utils"
import { updateUrlNoNav, buildPathWithQuery } from "@/hooks/list-query/list-query-url"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { useListQueryState } from "@/hooks/list-query/use-list-query-state"
import { usePageSizePreferenceOnce } from "@/hooks/use-page-size-preference"

export type WorkflowsPageSortKey = "UPDATED_DESC" | "UPDATED_ASC"
export type WorkflowsPageDepsStatusFilter = "ANY" | "IDLE" | "INSTALLING" | "READY" | "FAILED"
export type WorkflowsPageBoolConfiguredFilter = "ANY" | "CONFIGURED" | "NOT_CONFIGURED"

const WORKFLOWS_LS_PAGE_SIZE_KEY = "maia.workflows.pageSize.v1"

const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const
type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number]
const DEFAULT_PAGE_SIZE: AllowedPageSize = 20

function normalizePageSize(raw: unknown): AllowedPageSize {
  return normalizeAllowedInt(raw, ALLOWED_PAGE_SIZES, DEFAULT_PAGE_SIZE)
}

export function useWorkflowsPage<T extends { id: string }>() {
  type State = {
    qDraft: string
    q: string
    sort: WorkflowsPageSortKey
    depsStatus: WorkflowsPageDepsStatusFilter
    envConfigured: WorkflowsPageBoolConfiguredFilter
    inputSpecConfigured: WorkflowsPageBoolConfiguredFilter
    outputsSpecConfigured: WorkflowsPageBoolConfiguredFilter
    pageIndex: number
    pageSize: AllowedPageSize
  }

  const { state, setState, didInit } = useListQueryState<State>({
    basePath: "/workflows",
    defaults: {
      qDraft: "",
      q: "",
      sort: "UPDATED_DESC",
      depsStatus: "ANY",
      envConfigured: "ANY",
      inputSpecConfigured: "ANY",
      outputsSpecConfigured: "ANY",
      pageIndex: 0,
      pageSize: DEFAULT_PAGE_SIZE,
    },
    codec: {
      parse: (qp) => {
        const patch: Partial<State> = {}

        const q = qp.get("q")
        if (typeof q === "string" && q.trim()) {
          patch.qDraft = q
          patch.q = q
        }

        const sortRaw = qp.get("sort")
        if (sortRaw === "UPDATED_ASC" || sortRaw === "UPDATED_DESC") patch.sort = sortRaw

        const depsRaw = qp.get("depsStatus")
        if (depsRaw === "IDLE" || depsRaw === "INSTALLING" || depsRaw === "READY" || depsRaw === "FAILED") {
          patch.depsStatus = depsRaw
        }

        const envRaw = qp.get("envConfigured")
        if (envRaw === "CONFIGURED" || envRaw === "NOT_CONFIGURED") patch.envConfigured = envRaw

        const inputSpecRaw = qp.get("inputSpecConfigured")
        if (inputSpecRaw === "CONFIGURED" || inputSpecRaw === "NOT_CONFIGURED") patch.inputSpecConfigured = inputSpecRaw

        const outputsSpecRaw = qp.get("outputsSpecConfigured")
        if (outputsSpecRaw === "CONFIGURED" || outputsSpecRaw === "NOT_CONFIGURED")
          patch.outputsSpecConfigured = outputsSpecRaw

        const pageRaw = qp.get("page")
        const initialPage = pageRaw ? Number(pageRaw) : 1
        patch.pageIndex = Math.max(0, clampInt(initialPage, 1, 10_000) - 1)

        const pageSizeRaw = qp.get("pageSize")
        if (pageSizeRaw != null) patch.pageSize = normalizePageSize(pageSizeRaw)

        return patch
      },
      serialize: (s, qp) => {
        const q = s.q.trim()
        if (q) qp.set("q", q)
        else qp.delete("q")

        if (s.sort !== "UPDATED_DESC") qp.set("sort", s.sort)
        else qp.delete("sort")

        if (s.depsStatus !== "ANY") qp.set("depsStatus", s.depsStatus)
        else qp.delete("depsStatus")

        if (s.envConfigured !== "ANY") qp.set("envConfigured", s.envConfigured)
        else qp.delete("envConfigured")

        if (s.inputSpecConfigured !== "ANY") qp.set("inputSpecConfigured", s.inputSpecConfigured)
        else qp.delete("inputSpecConfigured")

        if (s.outputsSpecConfigured !== "ANY") qp.set("outputsSpecConfigured", s.outputsSpecConfigured)
        else qp.delete("outputsSpecConfigured")

        if (s.pageIndex > 0) qp.set("page", String(s.pageIndex + 1))
        else qp.delete("page")

        if (s.pageSize !== DEFAULT_PAGE_SIZE) qp.set("pageSize", String(s.pageSize))
        else qp.delete("pageSize")

        return qp
      },
    },
    resetPageIndexDeps: [
      (s) => s.q,
      (s) => s.sort,
      (s) => s.depsStatus,
      (s) => s.envConfigured,
      (s) => s.inputSpecConfigured,
      (s) => s.outputsSpecConfigured,
      (s) => s.pageSize,
    ],
    onResetPageIndex: () => setState((prev) => ({ ...prev, pageIndex: 0 })),
    urlMode: { strategy: "replaceState", kind: "replace" },
  })

  const [filtersOpen, setFiltersOpen] = React.useState("")
  const [createOpen, setCreateOpen] = React.useState(false)

  React.useEffect(() => {
    if (!didInit) return
    const tmr = window.setTimeout(() => {
      setState((prev) => (prev.q === prev.qDraft ? prev : { ...prev, q: prev.qDraft }))
    }, 250)
    return () => window.clearTimeout(tmr)
  }, [didInit, state.qDraft])

  // One-shot: open create sheet via action=new, then clean it from URL.
  React.useEffect(() => {
    if (!didInit) return
    if (typeof window === "undefined") return
    const qp = new URLSearchParams(window.location.search)
    if (qp.get("action") !== "new") return
    setCreateOpen(true)
    qp.delete("action")
    updateUrlNoNav(buildPathWithQuery("/workflows", qp), "replace")
  }, [didInit])

  usePageSizePreferenceOnce<AllowedPageSize>({
    didInit,
    storageKey: WORKFLOWS_LS_PAGE_SIZE_KEY,
    normalize: normalizePageSize,
    getCurrent: () => state.pageSize,
    setNext: (next) => setState((prev) => (prev.pageSize === next ? prev : { ...prev, pageSize: next })),
  })

  React.useEffect(() => {
    if (!didInit) return
    safeWriteLocalStorageJson(WORKFLOWS_LS_PAGE_SIZE_KEY, state.pageSize)
  }, [didInit, state.pageSize])

  const query = useListQuery<{ workflows: T[]; total: number; totalAll: number }>({
    queryKey: [
      "workflows",
      {
        q: state.q.trim(),
        sort: state.sort,
        depsStatus: state.depsStatus,
        envConfigured: state.envConfigured,
        inputSpecConfigured: state.inputSpecConfigured,
        outputsSpecConfigured: state.outputsSpecConfigured,
        pageIndex: state.pageIndex,
        pageSize: state.pageSize,
      },
    ],
    enabled: true,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      const q = state.q.trim()
      if (q) params.set("q", q)
      if (state.depsStatus !== "ANY") params.set("depsStatus", state.depsStatus)
      if (state.envConfigured !== "ANY") params.set("envConfigured", state.envConfigured)
      if (state.inputSpecConfigured !== "ANY") params.set("inputSpecConfigured", state.inputSpecConfigured)
      if (state.outputsSpecConfigured !== "ANY") params.set("outputsSpecConfigured", state.outputsSpecConfigured)
      params.set("page", String(state.pageIndex + 1))
      params.set("pageSize", String(state.pageSize))
      params.set("sort", state.sort)
      return await apiFetchJson(`/api/workflows?${params.toString()}`, { cache: "no-store", signal })
    },
  })

  const rows = Array.isArray(query.data?.workflows) ? (query.data?.workflows as T[]) : []
  const total = Number(query.data?.total) || 0
  const totalAll = Number(query.data?.totalAll) || 0
  const hasData = !!query.data
  const initialLoading = query.isLoading && !hasData
  const refreshing = query.isFetching && hasData
  const loading = initialLoading
  const loadError = (query.error ?? null) as unknown

  const totalPages = React.useMemo(() => Math.max(1, Math.ceil(total / state.pageSize)), [total, state.pageSize])
  const safePageIndex = React.useMemo(() => Math.min(state.pageIndex, totalPages - 1), [state.pageIndex, totalPages])

  React.useEffect(() => {
    if (!didInit) return
    if (state.pageIndex !== safePageIndex) setState((prev) => ({ ...prev, pageIndex: safePageIndex }))
  }, [didInit, safePageIndex, state.pageIndex])

  function setSearch(next: string, p?: { immediate?: boolean }) {
    setState((prev) => ({ ...prev, qDraft: next, ...(p?.immediate ? { q: next } : {}) }))
  }

  function resetAllFilters() {
    setFiltersOpen("")
    setSearch("", { immediate: true })
    setState((prev) => ({
      ...prev,
      sort: "UPDATED_DESC",
      depsStatus: "ANY",
      envConfigured: "ANY",
      inputSpecConfigured: "ANY",
      outputsSpecConfigured: "ANY",
      pageIndex: 0,
    }))
  }

  return {
    // data
    rows,
    total,
    totalAll,
    loading,
    refreshing,
    loadError,

    // query + filters
    q: state.qDraft,
    setSearch,
    sort: state.sort,
    setSort: (next: WorkflowsPageSortKey) => setState((prev) => ({ ...prev, sort: next })),
    depsStatus: state.depsStatus,
    setDepsStatus: (next: WorkflowsPageDepsStatusFilter) => setState((prev) => ({ ...prev, depsStatus: next })),
    envConfigured: state.envConfigured,
    setEnvConfigured: (next: WorkflowsPageBoolConfiguredFilter) =>
      setState((prev) => ({ ...prev, envConfigured: next })),
    inputSpecConfigured: state.inputSpecConfigured,
    setInputSpecConfigured: (next: WorkflowsPageBoolConfiguredFilter) =>
      setState((prev) => ({ ...prev, inputSpecConfigured: next })),
    outputsSpecConfigured: state.outputsSpecConfigured,
    setOutputsSpecConfigured: (next: WorkflowsPageBoolConfiguredFilter) =>
      setState((prev) => ({ ...prev, outputsSpecConfigured: next })),
    filtersOpen,
    setFiltersOpen,

    // pagination
    pageSize: state.pageSize,
    setPageSize: (n: number) => setState((prev) => ({ ...prev, pageSize: normalizePageSize(n) })),
    pageIndex: safePageIndex,
    setPageIndex: (n: number) => setState((prev) => ({ ...prev, pageIndex: Math.max(0, Math.floor(n)) })),
    totalPages,
    safePageIndex,

    // create sheet
    createOpen,
    setCreateOpen,

    // actions
    refresh: async () => {
      await query.refetch()
    },
    resetAllFilters,
  }
}

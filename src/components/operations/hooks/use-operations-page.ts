"use client"

import * as React from "react"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"

import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson } from "@/lib/shared/http/api"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { toCanonicalOperationStatus } from "@/lib/shared/operation-status"
import { clampInt, normalizeAllowedInt, safeWriteLocalStorageJson } from "@/hooks/list-page-utils"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { useListQueryState } from "@/hooks/list-query/use-list-query-state"
import { useOperationsListSsePatch } from "@/components/operations/hooks/use-operations-list-sse-patch"
import { usePageSizePreferenceOnce } from "@/hooks/use-page-size-preference"
import { useViewer } from "@/hooks/use-viewer"
import { makeListTopicForViewer } from "@/lib/shared/realtime/viewer-topics"

export type OperationRow = {
  id: string
  publicId: string
  publicNumber: number
  status: string
  action: string
  scope: string | null
  targetType: string | null
  targetId: string | null
  audit: { actor: string | null; tenantId: string | null; requestId: string | null }
  progress: {
    current: number
    total: number | null
    messageKey: string | null
    messageParams: Record<string, string | number> | null
  }
  responseStatus: number | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type OperationsSortKey = "CREATED_DESC" | "CREATED_ASC"

const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const
type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number]
const DEFAULT_PAGE_SIZE: AllowedPageSize = 20

const OPS_LS_PAGE_SIZE_KEY = "maia.operations.pageSize.v1"
function normalizePageSize(raw: unknown): AllowedPageSize {
  return normalizeAllowedInt(raw, ALLOWED_PAGE_SIZES, DEFAULT_PAGE_SIZE)
}

export function useOperationsPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const viewer = useViewer()

  type State = {
    qDraft: string
    q: string
    exactStatus: string
    sort: OperationsSortKey
    pageIndex: number
    pageSize: AllowedPageSize
  }

  const basePath = "/operations"

  const { state, setState, didInit } = useListQueryState<State>({
    basePath,
    defaults: {
      qDraft: "",
      q: "",
      exactStatus: "ANY",
      sort: "CREATED_DESC",
      pageIndex: 0,
      pageSize: DEFAULT_PAGE_SIZE,
    },
    codec: {
      parse: (qp) => {
        const q = qp.get("q")
        const status = qp.get("status")
        const sortRaw = qp.get("sort")
        const pageSizeRaw = qp.get("pageSize")
        const pageRaw = qp.get("page")

        const patch: Partial<State> = {}
        if (typeof q === "string" && q.trim()) {
          patch.qDraft = q
          patch.q = q
        }
        if (typeof status === "string" && status.trim()) patch.exactStatus = status
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

        if (s.exactStatus !== "ANY") qp.set("status", s.exactStatus)
        else qp.delete("status")

        if (s.sort !== "CREATED_DESC") qp.set("sort", s.sort)
        else qp.delete("sort")

        if (s.pageSize !== DEFAULT_PAGE_SIZE) qp.set("pageSize", String(s.pageSize))
        else qp.delete("pageSize")

        if (s.pageIndex > 0) qp.set("page", String(s.pageIndex + 1))
        else qp.delete("page")

        return qp
      },
    },
    resetPageIndexDeps: [(s) => s.q, (s) => s.exactStatus, (s) => s.sort, (s) => s.pageSize],
    onResetPageIndex: () => setState((prev) => ({ ...prev, pageIndex: 0 })),
    urlMode: { strategy: "replaceState", kind: "replace" },
  })

  const [pendingNew, setPendingNew] = React.useState<OperationRow[]>([])
  const [pendingCount, setPendingCount] = React.useState<number>(0)
  const pendingIdsRef = React.useRef<Set<string>>(new Set())

  const clearPendingNew = React.useCallback(() => {
    pendingIdsRef.current.clear()
    setPendingNew([])
    setPendingCount(0)
  }, [])

  const addPendingNew = React.useCallback(
    (row: OperationRow) => {
      if (pendingIdsRef.current.has(row.id)) return false
      pendingIdsRef.current.add(row.id)
      setPendingNew((prev) => [row, ...prev])
      setPendingCount((prev) => prev + 1)
      return true
    },
    [setPendingCount],
  )

  const updatePendingNew = React.useCallback((row: OperationRow) => {
    const id = String(row?.id ?? "")
    if (!id) return
    if (!pendingIdsRef.current.has(id)) return
    setPendingNew((prev) => prev.map((x) => (String(x?.id ?? "") === id ? { ...x, ...row } : x)))
  }, [])

  const canLoadPending = state.pageIndex === 0 && state.sort === "CREATED_DESC"
  const loadPendingNew = React.useCallback(
    (opts?: { force?: boolean }) => {
      if (!canLoadPending) {
        toast(t("operations.pendingNewSwitchToast"))
        return
      }
      if (pendingNew.length === 0 && !opts?.force) return

      queryClient.setQueryData<{ operations: OperationRow[]; total: number }>(activeQueryKeyRef.current, (old) => {
        if (!old) return old
        const prev = Array.isArray(old.operations) ? old.operations : []
        if (pendingNew.length === 0) return old
        const seen = new Set(prev.map((x) => x.id))
        const insert = pendingNew.filter((x) => !seen.has(x.id))
        const nextOps = [...insert, ...prev]
        if (nextOps.length > state.pageSize) nextOps.length = state.pageSize
        return { ...old, operations: nextOps }
      })
      clearPendingNew()
    },
    [canLoadPending, clearPendingNew, pendingNew, queryClient, state.pageSize, t],
  )

  const goToNewestView = React.useCallback(() => {
    setState((prev) => ({ ...prev, sort: "CREATED_DESC", pageIndex: 0 }))
  }, [])

  const setSearch = React.useCallback((next: string) => {
    setState((prev) => ({ ...prev, qDraft: next }))
  }, [])

  const exactStatusOptions = React.useMemo(() => {
    const known = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]
    return ["ANY", ...known]
  }, [])

  React.useEffect(() => {
    if (!didInit) return
    const tmr = window.setTimeout(() => {
      setState((prev) => (prev.q === prev.qDraft ? prev : { ...prev, q: prev.qDraft }))
    }, 250)
    return () => window.clearTimeout(tmr)
  }, [didInit, state.qDraft])

  usePageSizePreferenceOnce<AllowedPageSize>({
    didInit,
    storageKey: OPS_LS_PAGE_SIZE_KEY,
    normalize: normalizePageSize,
    getCurrent: () => state.pageSize,
    setNext: (next) => setState((prev) => (prev.pageSize === next ? prev : { ...prev, pageSize: next })),
  })

  React.useEffect(() => {
    if (!didInit) return
    safeWriteLocalStorageJson(OPS_LS_PAGE_SIZE_KEY, state.pageSize)
  }, [didInit, state.pageSize])

  const queryKey = React.useMemo<QueryKey>(
    () => [
      "operations",
      {
        q: state.q.trim(),
        exactStatus: state.exactStatus,
        sort: state.sort,
        pageIndex: state.pageIndex,
        pageSize: state.pageSize,
      },
    ],
    [state.exactStatus, state.pageIndex, state.pageSize, state.q, state.sort],
  )

  const activeQueryKeyRef = React.useRef<QueryKey>(queryKey)
  React.useEffect(() => {
    activeQueryKeyRef.current = queryKey
  }, [queryKey])

  const query = useListQuery<{ operations: OperationRow[]; total: number }>({
    queryKey,
    enabled: true,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      params.set("page", String(state.pageIndex + 1))
      params.set("pageSize", String(state.pageSize))
      params.set("sort", state.sort)

      const q = state.q.trim()
      if (q) params.set("q", q)
      if (state.exactStatus !== "ANY") params.set("status", state.exactStatus)

      return await apiFetchJson(`/api/operations?${params.toString()}`, { cache: "no-store", signal })
    },
  })

  const operations = Array.isArray(query.data?.operations) ? (query.data?.operations as OperationRow[]) : []
  const total = Number(query.data?.total) || 0
  const hasData = !!query.data
  const initialLoading = query.isLoading && !hasData
  const refreshing = query.isFetching && hasData
  const loading = initialLoading
  const loadError = (query.error ?? null) as unknown

  const totalPages = React.useMemo(() => Math.max(1, Math.ceil(total / state.pageSize)), [state.pageSize, total])
  const safePageIndex = React.useMemo(() => Math.min(state.pageIndex, totalPages - 1), [state.pageIndex, totalPages])
  const pageRows = operations

  React.useEffect(() => {
    if (!didInit) return
    if (state.pageIndex !== safePageIndex) setState((prev) => ({ ...prev, pageIndex: safePageIndex }))
  }, [didInit, safePageIndex, state.pageIndex])

  const refresh = React.useCallback(async () => {
    await query.refetch()
  }, [query.refetch])

  React.useEffect(() => {
    // Pending buffer is only valid for the current query filters.
    clearPendingNew()
  }, [clearPendingNew, state.exactStatus, state.q])

  const sseCtxRef = React.useRef({
    search: "",
    exactStatus: "ANY",
    sort: "CREATED_DESC" as OperationsSortKey,
    pageSize: DEFAULT_PAGE_SIZE as AllowedPageSize,
    pageIndex: 0,
  })
  React.useEffect(() => {
    sseCtxRef.current = {
      search: state.q,
      exactStatus: state.exactStatus,
      sort: state.sort,
      pageSize: state.pageSize,
      pageIndex: state.pageIndex,
    }
  }, [state.exactStatus, state.pageIndex, state.pageSize, state.q, state.sort])

  function rowFromSse(data: unknown): OperationRow | null {
    if (!data || typeof data !== "object") return null
    const rec = data as Record<string, unknown>
    const id = String(rec.operationId ?? "")
    if (!id) return null
    const m = id.match(/-(\d+)$/)
    const publicNumber = m ? Number(m[1]) : 0
    return {
      id,
      publicId: id,
      publicNumber: Number.isFinite(publicNumber) ? publicNumber : 0,
      status: String(rec.status ?? ""),
      action: String(rec.action ?? ""),
      scope: rec.scope == null ? null : String(rec.scope),
      targetType: rec.targetType == null ? null : String(rec.targetType),
      targetId: rec.targetId == null ? null : String(rec.targetId),
      audit: {
        actor: rec.actor == null ? null : String(rec.actor),
        tenantId: rec.tenantId == null ? null : String(rec.tenantId),
        requestId: rec.requestId == null ? null : String(rec.requestId),
      },
      progress: {
        current: typeof rec.progressCurrent === "number" ? rec.progressCurrent : 0,
        total: typeof rec.progressTotal === "number" ? rec.progressTotal : null,
        messageKey: rec.progressMessageKey == null ? null : String(rec.progressMessageKey),
        messageParams:
          rec.progressMessageParams &&
          typeof rec.progressMessageParams === "object" &&
          !Array.isArray(rec.progressMessageParams)
            ? (rec.progressMessageParams as Record<string, string | number>)
            : null,
      },
      responseStatus: typeof rec.responseStatus === "number" ? rec.responseStatus : null,
      errorCode: rec.errorCode == null ? null : String(rec.errorCode),
      errorMessage: rec.errorMessage == null ? null : String(rec.errorMessage),
      createdAt: rec.createdAt ? String(rec.createdAt) : "",
      updatedAt: rec.updatedAt ? String(rec.updatedAt) : "",
      completedAt: rec.completedAt == null ? null : String(rec.completedAt),
    }
  }

  function matchesFilters(row: OperationRow, ctx: typeof sseCtxRef.current) {
    const st = toCanonicalOperationStatus(row.status)
    if (ctx.exactStatus !== "ANY" && toCanonicalOperationStatus(ctx.exactStatus) !== st) return false
    const q = ctx.search.trim().toLowerCase()
    if (!q) return true
    const hay = [row.id, row.action, row.targetId ?? "", row.audit?.requestId ?? ""]
      .map((s) => String(s ?? "").toLowerCase())
      .join(" ")
    return hay.includes(q)
  }

  // Strategy A (SSE → patch cache):
  // - Operations list updates frequently, and the SSE payload is sufficient to build/locate a row and update
  //   progress fields, so patching the active list cache is more real-time and avoids extra requests.
  // - New rows can cause view "jumping" (especially when paginating/filtering or not in newest view), so we buffer
  //   creates and only surface them when the user opts into the newest view.
  const listTopic = viewer ? makeListTopicForViewer("operations", viewer) : null
  const { connected: listStreamConnected } = useOperationsListSsePatch<OperationRow>({
    topic: listTopic,
    getActiveQueryKey: () => activeQueryKeyRef.current,
    matchesFilters: (row) => matchesFilters(row, sseCtxRef.current),
    rowFromSse: (msg) => {
      if (!msg || typeof msg !== "object") return null
      const m = msg as Record<string, unknown>
      const type = m.type
      if (type !== "operation_created" && type !== "operation_progress" && type !== "operation_completed") return null
      const row = rowFromSse(m.data)
      if (!row) return null
      return { type, row }
    },
    canBufferNew: canLoadPending,
    hasPendingId: (id) => pendingIdsRef.current.has(id),
    addPending: addPendingNew,
    updatePending: updatePendingNew,
    bumpTotal: () => {
      queryClient.setQueryData<{ operations: OperationRow[]; total: number }>(activeQueryKeyRef.current, (old) => {
        if (!old) return old
        return { ...old, total: Number(old.total || 0) + 1 }
      })
    },
  })

  function statusLabel(status: string) {
    const s = toCanonicalOperationStatus(status)
    if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
    if (s === "FAILED") return t("common.statusValues.failed")
    if (s === "RUNNING") return t("common.statusValues.running")
    if (s === "PENDING") return t("operations.statusPending")
    return s || "—"
  }

  async function copyText(text: string) {
    try {
      await copyTextToClipboard(text)
      toast(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  return {
    total,
    operations,
    search: state.qDraft,
    exactStatus: state.exactStatus,
    sort: state.sort,
    loading,
    refreshing,
    loadError,
    // Expose for diagnostics/UI if needed.
    listStreamConnected,
    pageSize: state.pageSize,
    totalPages,
    safePageIndex,
    pageRows,
    exactStatusOptions,
    statusLabel,
    pendingCount,
    canLoadPending,
    loadPendingNew,
    goToNewestView,
    setSearch,
    setExactStatus: (next: string) => setState((prev) => ({ ...prev, exactStatus: next })),
    setSort: (next: OperationsSortKey) => setState((prev) => ({ ...prev, sort: next })),
    setPageSize: (n: number) => setState((prev) => ({ ...prev, pageSize: normalizePageSize(n) })),
    setPageIndex: (n: number) => setState((prev) => ({ ...prev, pageIndex: Math.max(0, Math.floor(n)) })),
    refresh,
    copyText,
  }
}

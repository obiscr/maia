"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { clampInt, normalizeAllowedInt, safeWriteLocalStorageJson } from "@/hooks/list-page-utils"
import { buildPathWithQuery, updateUrlNoNav } from "@/hooks/list-query/list-query-url"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { useListQueryState } from "@/hooks/list-query/use-list-query-state"
import { usePageSizePreferenceOnce } from "@/hooks/use-page-size-preference"

export type ScheduleRow = {
  id: string
  publicId: string
  publicNumber: number
  name: string | null
  enabled: boolean
  workflowId: string
  workflowName: string
  lastJobId?: string | null
  lastRunId?: string | null
  kind: string
  cron: string | null
  timezone: string
  intervalMs: number | null
  nextRunAt: string | null
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

export type SchedulesSortKey = "CREATED_DESC" | "CREATED_ASC"

const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const
type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number]
const DEFAULT_PAGE_SIZE: AllowedPageSize = 20

const SCHEDULES_LS_PAGE_SIZE_KEY = "maia.schedules.pageSize.v1"
function normalizePageSize(raw: unknown): AllowedPageSize {
  return normalizeAllowedInt(raw, ALLOWED_PAGE_SIZES, DEFAULT_PAGE_SIZE)
}

export function useSchedulesPage() {
  const { t } = useI18n()
  const mountedRef = React.useRef(true)

  type State = {
    qDraft: string
    q: string
    exactStatus: string
    sort: SchedulesSortKey
    pageSize: AllowedPageSize
    pageIndex: number
  }

  const { state, setState, didInit } = useListQueryState<State>({
    basePath: "/schedules",
    defaults: {
      qDraft: "",
      q: "",
      exactStatus: "ANY",
      sort: "CREATED_DESC",
      pageSize: DEFAULT_PAGE_SIZE,
      pageIndex: 0,
    },
    codec: {
      parse: (qp) => {
        const patch: Partial<State> = {}
        const q = qp.get("q")
        if (typeof q === "string" && q.trim()) {
          patch.qDraft = q
          patch.q = q
        }
        const status = qp.get("status")
        if (status === "ENABLED" || status === "DISABLED") patch.exactStatus = status
        const sortRaw = qp.get("sort")
        if (sortRaw === "CREATED_ASC" || sortRaw === "CREATED_DESC") patch.sort = sortRaw
        const pageSizeRaw = qp.get("pageSize")
        if (pageSizeRaw != null) patch.pageSize = normalizePageSize(pageSizeRaw)
        const pageRaw = qp.get("page")
        const initialPage = pageRaw ? Number(pageRaw) : 1
        patch.pageIndex = Math.max(0, clampInt(initialPage, 1, 10_000) - 1)
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

  const [createOpen, setCreateOpen] = React.useState(false)

  const exactStatusOptions = React.useMemo(() => ["ANY", "ENABLED", "DISABLED"], [])

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
    updateUrlNoNav(buildPathWithQuery("/schedules", qp), "replace")
  }, [didInit])

  usePageSizePreferenceOnce<AllowedPageSize>({
    didInit,
    storageKey: SCHEDULES_LS_PAGE_SIZE_KEY,
    normalize: normalizePageSize,
    getCurrent: () => state.pageSize,
    setNext: (next) => setState((prev) => (prev.pageSize === next ? prev : { ...prev, pageSize: next })),
  })

  React.useEffect(() => {
    if (!didInit) return
    safeWriteLocalStorageJson(SCHEDULES_LS_PAGE_SIZE_KEY, state.pageSize)
  }, [didInit, state.pageSize])

  const query = useListQuery<{ schedules: ScheduleRow[]; total: number }>({
    queryKey: [
      "schedules",
      {
        q: state.q.trim(),
        exactStatus: state.exactStatus,
        sort: state.sort,
        pageIndex: state.pageIndex,
        pageSize: state.pageSize,
      },
    ],
    enabled: true,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      params.set("page", String(state.pageIndex + 1))
      params.set("pageSize", String(state.pageSize))
      params.set("sort", state.sort)
      const q = state.q.trim()
      if (q) params.set("q", q)
      if (state.exactStatus !== "ANY") params.set("status", state.exactStatus)
      return await apiFetchJson(`/api/schedules?${params.toString()}`, { cache: "no-store", signal })
    },
  })

  const schedules = Array.isArray(query.data?.schedules) ? (query.data?.schedules as ScheduleRow[]) : []
  const total = Number(query.data?.total) || 0
  const hasData = !!query.data
  const initialLoading = query.isLoading && !hasData
  const refreshing = query.isFetching && hasData
  const loading = initialLoading
  const loadError = (query.error ?? null) as unknown

  const totalPages = React.useMemo(() => Math.max(1, Math.ceil(total / state.pageSize)), [total, state.pageSize])
  const safePageIndex = React.useMemo(() => Math.min(state.pageIndex, totalPages - 1), [state.pageIndex, totalPages])
  const pageRows = schedules

  React.useEffect(() => {
    if (!didInit) return
    if (state.pageIndex !== safePageIndex) setState((prev) => ({ ...prev, pageIndex: safePageIndex }))
  }, [didInit, safePageIndex, state.pageIndex])

  const refresh = React.useCallback(async () => {
    await query.refetch()
  }, [query])

  function statusLabel(v: string) {
    if (v === "ENABLED") return t("schedules.statusEnabled")
    if (v === "DISABLED") return t("schedules.statusDisabled")
    return v || "—"
  }

  async function copyText(text: string) {
    try {
      await copyTextToClipboard(text)
      toast(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  async function updateSchedule(
    scheduleId: string,
    patch: Partial<{
      name: string | null
      enabled: boolean
      kind: "CRON" | "INTERVAL"
      cron: string | null
      timezone: string | null
      intervalMs: number | null
      misfirePolicy: "SKIP" | "FIRE_ONCE" | "CATCH_UP"
      catchUpLimit: number | null
      overlapPolicy: "SKIP" | "ALLOW"
      pinnedWorkflowVersionNumber: number | null
      inputJson: unknown
    }>,
    opts?: { successToastKey?: string; errorFallbackKey?: string },
  ) {
    try {
      await apiFetchJson(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch ?? {}),
      })
      toast.success(t(opts?.successToastKey ?? "schedules.updatedToast"))
      await refresh()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: opts?.errorFallbackKey ?? "common.updateFailed" }))
    }
  }

  async function runNow(scheduleId: string) {
    try {
      await apiFetchJson(`/api/schedules/${scheduleId}/run-now`, { method: "POST" })
      toast.success(t("common.jobEnqueuedToast"))
      await refresh()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "schedules.runNowActionFailed" }))
    }
  }

  const onCreateOpenChange = React.useCallback((open: boolean) => {
    setCreateOpen(open)
  }, [])

  return {
    total,
    search: state.qDraft,
    exactStatus: state.exactStatus,
    sort: state.sort,
    loading,
    refreshing,
    loadError,
    pageSize: state.pageSize,
    createOpen,
    exactStatusOptions,
    totalPages,
    safePageIndex,
    pageRows,
    statusLabel,
    setSearch: (next: string) => setState((prev) => ({ ...prev, qDraft: next })),
    setExactStatus: (next: string) => setState((prev) => ({ ...prev, exactStatus: next })),
    setSort: (next: SchedulesSortKey) => setState((prev) => ({ ...prev, sort: next })),
    setPageSize: (n: number) => setState((prev) => ({ ...prev, pageSize: normalizePageSize(n) })),
    setPageIndex: (n: number) => setState((prev) => ({ ...prev, pageIndex: Math.max(0, Math.floor(n)) })),
    refresh,
    copyText,
    updateSchedule,
    runNow,
    onCreateOpenChange,
  }
}

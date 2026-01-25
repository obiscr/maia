"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { toCanonicalRunStatus } from "@/lib/shared/run-status"
import { calcDurationMs, formatAbsoluteTime, formatDurationMs } from "@/lib/shared/format/time"
import {
  clampInt,
  normalizeAllowedInt,
  safeReadLocalStorageJson,
  safeWriteLocalStorageJson,
} from "@/hooks/list-page-utils"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { useListQueryState } from "@/hooks/list-query/use-list-query-state"
import { isRecord } from "@/lib/shared/lang/is-record"
import { usePageSizePreferenceOnce } from "@/hooks/use-page-size-preference"
import { useTimezone } from "@/components/timezone-provider"

export type RunRow = {
  id: string
  publicId: string
  publicNumber: number
  workflowId: string
  workflowName: string
  workflowVersionNumber: number | null
  status: string
  cancelRequestedAt?: string | null
  failureCode?: string | null
  failureMessage?: string | null
  failureMetaJson?: string | null
  failureAt?: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  stepsTotal: number
  stepsDone: number
  runningStepName: string | null
  failedStepName: string | null
  inputParamsCount: number
  inputFilesCount: number
  artifactsCount: number
  attemptsCount: number
}

export type RunsSortKey = "CREATED_DESC" | "CREATED_ASC"

const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const
type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number]

const DEFAULT_PAGE_SIZE: AllowedPageSize = 20

export type RunsVisibleCols = {
  runId: boolean
  status: boolean
  duration: boolean
  createdAt: boolean
  startedAt: boolean
  finishedAt: boolean
  actions: boolean
}

const RUNS_LS_VISIBLE_COLS_KEY = "maia.runs.visibleCols.v1"
const RUNS_LS_PAGE_SIZE_KEY = "maia.runs.pageSize.v2"

const DEFAULT_VISIBLE_COLS: RunsVisibleCols = {
  runId: true,
  status: true,
  duration: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  actions: true,
}

function toColsParam(cols: RunsVisibleCols) {
  const keys = Object.keys(DEFAULT_VISIBLE_COLS) as Array<keyof RunsVisibleCols>
  return keys.filter((k) => cols[k]).join(",")
}

function parseColsParam(raw: string | null | undefined): RunsVisibleCols | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  const keys = Object.keys(DEFAULT_VISIBLE_COLS) as Array<keyof RunsVisibleCols>
  const set = new Set(
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  )
  const out: RunsVisibleCols = { ...DEFAULT_VISIBLE_COLS }
  // Default to false, then enable only requested keys.
  for (const k of keys) out[k] = false
  for (const k of keys) {
    if (set.has(String(k))) out[k] = true
  }
  const any = keys.some((k) => out[k])
  return any ? out : null
}

function normalizePageSize(raw: unknown): AllowedPageSize {
  return normalizeAllowedInt(raw, ALLOWED_PAGE_SIZES, DEFAULT_PAGE_SIZE)
}

export function useRunsPage() {
  const { t, locale } = useI18n()
  const { effectiveTimezone } = useTimezone()
  const mountedRef = React.useRef(true)

  type State = {
    qDraft: string
    q: string
    exactStatus: string
    sort: RunsSortKey
    pageSize: AllowedPageSize
    pageIndex: number
  }

  const { state, setState, didInit } = useListQueryState<State>({
    basePath: "/runs",
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
        if (typeof status === "string" && status.trim()) patch.exactStatus = status
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
        qp.delete("cols")
        return qp
      },
    },
    resetPageIndexDeps: [(s) => s.q, (s) => s.exactStatus, (s) => s.sort, (s) => s.pageSize],
    onResetPageIndex: () => setState((prev) => ({ ...prev, pageIndex: 0 })),
    urlMode: { strategy: "replaceState", kind: "replace" },
  })

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())

  const [visibleCols, setVisibleCols] = React.useState<RunsVisibleCols>(DEFAULT_VISIBLE_COLS)

  const exactStatusOptions = React.useMemo(() => {
    const known = ["PENDING_INPUTS", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]
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
    storageKey: RUNS_LS_PAGE_SIZE_KEY,
    normalize: normalizePageSize,
    getCurrent: () => state.pageSize,
    setNext: (next) => setState((prev) => (prev.pageSize === next ? prev : { ...prev, pageSize: next })),
  })

  // Column visibility is a local preference.
  React.useEffect(() => {
    if (!didInit) return
    const storedCols = safeReadLocalStorageJson(RUNS_LS_VISIBLE_COLS_KEY)
    const colsFromStorage = isRecord(storedCols)
      ? parseColsParam(
          Object.keys(storedCols)
            .filter((k) => storedCols[k] === true)
            .join(","),
        )
      : null
    const initialCols = colsFromStorage ?? DEFAULT_VISIBLE_COLS
    setVisibleCols(initialCols)
  }, [didInit])

  const query = useListQuery<{ runs: RunRow[]; total: number }>({
    queryKey: [
      "runs",
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
      return await apiFetchJson(`/api/runs?${params.toString()}`, { cache: "no-store", signal })
    },
  })

  const runs = Array.isArray(query.data?.runs) ? (query.data?.runs as RunRow[]) : []
  const total = Number(query.data?.total) || 0
  const hasData = !!query.data
  const initialLoading = query.isLoading && !hasData
  const refreshing = query.isFetching && hasData
  const loading = initialLoading
  const loadError = (query.error ?? null) as unknown

  const totalPages = React.useMemo(() => Math.max(1, Math.ceil(total / state.pageSize)), [total, state.pageSize])
  const safePageIndex = React.useMemo(() => Math.min(state.pageIndex, totalPages - 1), [state.pageIndex, totalPages])
  const pageRows = runs

  React.useEffect(() => {
    if (!didInit) return
    if (state.pageIndex !== safePageIndex) setState((prev) => ({ ...prev, pageIndex: safePageIndex }))
  }, [didInit, safePageIndex, state.pageIndex])

  const refresh = React.useCallback(async () => {
    await query.refetch()
  }, [query])

  function statusLabel(status: string) {
    const s = toCanonicalRunStatus(status)
    if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
    if (s === "FAILED") return t("common.statusValues.failed")
    if (s === "RUNNING") return t("common.statusValues.running")
    if (s === "PENDING_INPUTS") return t("common.statusValues.queuedInputs")
    if (s === "CANCELING") return t("common.statusValues.canceling")
    if (s === "CANCELED") return t("common.statusValues.canceled")
    return s || "—"
  }

  function formatTime(ts: string | null) {
    return formatAbsoluteTime(ts, { locale, timeZone: effectiveTimezone })
  }

  function runDurationMs(r: RunRow) {
    return calcDurationMs(r.startedAt, r.finishedAt)
  }

  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selectedIds.has(r.id))
  const somePageSelected = pageRows.some((r) => selectedIds.has(r.id))
  const headerChecked: boolean | "indeterminate" = allPageSelected ? true : somePageSelected ? "indeterminate" : false

  function toggleSelectAllPage(next: boolean) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      for (const r of pageRows) {
        if (next) n.add(r.id)
        else n.delete(r.id)
      }
      return n
    })
  }

  function toggleRow(id: string, next: boolean) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (next) n.add(id)
      else n.delete(id)
      return n
    })
  }

  async function copyText(text: string) {
    try {
      await copyTextToClipboard(text)
      // Neutral toast (no success icon) for copy actions.
      toast(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  async function cancelRun(runId: string) {
    const id = String(runId || "").trim()
    if (!id) return
    try {
      await apiFetchJson(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" })
      toast.success(t("runs.canceledToast"))
      await refresh()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    }
  }

  async function forceStopRun(runId: string) {
    const id = String(runId || "").trim()
    if (!id) return
    try {
      await apiFetchJson(`/api/runs/${encodeURIComponent(id)}/force-stop`, { method: "POST" })
      toast.success(t("runs.forceStopToast"))
      await refresh()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    }
  }

  // Persist view preferences.
  React.useEffect(() => {
    if (!didInit) return
    safeWriteLocalStorageJson(RUNS_LS_VISIBLE_COLS_KEY, visibleCols)
  }, [didInit, visibleCols])

  React.useEffect(() => {
    if (!didInit) return
    safeWriteLocalStorageJson(RUNS_LS_PAGE_SIZE_KEY, state.pageSize)
  }, [didInit, state.pageSize])

  return {
    // raw state
    runs,
    total,
    search: state.qDraft,
    exactStatus: state.exactStatus,
    sort: state.sort,
    loading,
    refreshing,
    loadError,
    pageSize: state.pageSize,
    pageIndex: safePageIndex,
    selectedIds,
    visibleCols,

    // derived
    exactStatusOptions,
    totalPages,
    safePageIndex,
    pageRows,
    headerChecked,

    // helpers
    statusLabel,
    formatTime,
    formatDurationMs,
    runDurationMs,

    // actions
    setSearch: (next: string) => setState((prev) => ({ ...prev, qDraft: next })),
    setExactStatus: (next: string) => setState((prev) => ({ ...prev, exactStatus: next })),
    setSort: (next: RunsSortKey) => setState((prev) => ({ ...prev, sort: next })),
    setPageSize: (n: number) => setState((prev) => ({ ...prev, pageSize: normalizePageSize(n) })),
    setPageIndex: (n: number) => setState((prev) => ({ ...prev, pageIndex: Math.max(0, Math.floor(n)) })),
    setSelectedIds,
    setVisibleCols,
    refresh: async () => {
      await query.refetch()
    },
    copyText,
    cancelRun,
    forceStopRun,
    toggleSelectAllPage,
    toggleRow,
  }
}

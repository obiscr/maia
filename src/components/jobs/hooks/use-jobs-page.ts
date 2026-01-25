"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { calcDurationMs, formatDurationMs } from "@/lib/shared/format/time"
import { toCanonicalJobStatus } from "@/lib/shared/job-status"
import { clampInt, normalizeAllowedInt, safeWriteLocalStorageJson } from "@/hooks/list-page-utils"
import { buildPathWithQuery, updateUrlNoNav } from "@/hooks/list-query/list-query-url"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { useListQueryState } from "@/hooks/list-query/use-list-query-state"
import { usePageSizePreferenceOnce } from "@/hooks/use-page-size-preference"

export type JobRow = {
  id: string
  publicId: string
  publicNumber: number
  workflowId: string
  workflowName: string
  status: string
  cancelRequestedAt?: string | null
  runCancelRequestedAt?: string | null
  runStatus?: string | null
  scheduledFor?: string | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  nextAttemptAt: string | null
  claimedBy: string | null
  claimedAt: string | null
  leaseExpiresAt: string | null
  attemptCount: number
  maxAttempts: number
  runId: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  lastErrorMetaJson: string | null
  lastErrorAt: string | null
  scheduleId: string | null
  scheduleName: string | null
  batchId: string | null
  batchName: string | null
}

export type JobsSortKey = "CREATED_DESC" | "CREATED_ASC"

const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const
type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number]
const DEFAULT_PAGE_SIZE: AllowedPageSize = 20

const JOBS_LS_PAGE_SIZE_KEY = "maia.jobs.pageSize.v1"
function normalizePageSize(raw: unknown): AllowedPageSize {
  return normalizeAllowedInt(raw, ALLOWED_PAGE_SIZES, DEFAULT_PAGE_SIZE)
}

export function useJobsPage() {
  const { t } = useI18n()
  const mountedRef = React.useRef(true)

  type State = {
    qDraft: string
    q: string
    exactStatus: string
    sort: JobsSortKey
    pageSize: AllowedPageSize
    pageIndex: number
  }

  const { state, setState, didInit } = useListQueryState<State>({
    basePath: "/jobs",
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
        // NOTE: One-shot params like `action=new` / `redirect=run` are consumed by dedicated effects.
        // Do NOT delete them here, otherwise URL mirroring can remove them before they are consumed.
        return qp
      },
    },
    resetPageIndexDeps: [(s) => s.q, (s) => s.exactStatus, (s) => s.sort, (s) => s.pageSize],
    onResetPageIndex: () => setState((prev) => ({ ...prev, pageIndex: 0 })),
    urlMode: { strategy: "replaceState", kind: "replace" },
  })

  const [createOpen, setCreateOpen] = React.useState(false)
  const [redirectTo, setRedirectTo] = React.useState<"job" | "run">("job")

  const exactStatusOptions = React.useMemo(() => {
    const known = ["QUEUED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]
    return ["ANY", ...known]
  }, [])

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

  // One-shot: redirect behavior after creating a job, and open New Job sheet.
  React.useEffect(() => {
    if (!didInit) return
    if (typeof window === "undefined") return
    const qp = new URLSearchParams(window.location.search)
    let changed = false

    if (qp.get("redirect") === "run") setRedirectTo("run")
    if (qp.has("redirect")) {
      qp.delete("redirect")
      changed = true
    }

    if (qp.get("action") === "new") {
      setCreateOpen(true)
      qp.delete("action")
      changed = true
    }

    if (changed) updateUrlNoNav(buildPathWithQuery("/jobs", qp), "replace")
  }, [didInit])

  usePageSizePreferenceOnce<AllowedPageSize>({
    didInit,
    storageKey: JOBS_LS_PAGE_SIZE_KEY,
    normalize: normalizePageSize,
    getCurrent: () => state.pageSize,
    setNext: (next) => setState((prev) => (prev.pageSize === next ? prev : { ...prev, pageSize: next })),
  })

  React.useEffect(() => {
    if (!didInit) return
    safeWriteLocalStorageJson(JOBS_LS_PAGE_SIZE_KEY, state.pageSize)
  }, [didInit, state.pageSize])

  const query = useListQuery<{ jobs: JobRow[]; total: number }>({
    queryKey: [
      "jobs",
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
      return await apiFetchJson(`/api/jobs?${params.toString()}`, { cache: "no-store", signal })
    },
  })

  const jobs = Array.isArray(query.data?.jobs) ? (query.data?.jobs as JobRow[]) : []
  const total = Number(query.data?.total) || 0
  const hasData = !!query.data
  const initialLoading = query.isLoading && !hasData
  const refreshing = query.isFetching && hasData
  const loading = initialLoading
  const loadError = (query.error ?? null) as unknown

  const totalPages = React.useMemo(() => Math.max(1, Math.ceil(total / state.pageSize)), [total, state.pageSize])
  const safePageIndex = React.useMemo(() => Math.min(state.pageIndex, totalPages - 1), [state.pageIndex, totalPages])
  const pageRows = jobs

  React.useEffect(() => {
    if (!didInit) return
    if (state.pageIndex !== safePageIndex) setState((prev) => ({ ...prev, pageIndex: safePageIndex }))
  }, [didInit, safePageIndex, state.pageIndex])

  const refresh = React.useCallback(async () => {
    await query.refetch()
  }, [query])

  function statusLabel(status: string) {
    const s = toCanonicalJobStatus(status)
    if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
    if (s === "FAILED") return t("common.statusValues.failed")
    if (s === "RUNNING") return t("common.statusValues.running")
    if (s === "PAUSED") return t("common.statusValues.paused")
    if (s === "QUEUED") return t("common.statusValues.queued")
    if (s === "CANCELED") return t("common.statusValues.canceled")
    return s || "—"
  }

  function jobDurationMs(r: JobRow) {
    return calcDurationMs(r.startedAt, r.finishedAt)
  }

  async function copyText(text: string) {
    try {
      await copyTextToClipboard(text)
      toast(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  async function resumeJob(jobId: string) {
    try {
      await apiFetchJson(`/api/jobs/${jobId}/resume`, { method: "POST" })
      toast.success(t("common.jobEnqueuedToast"))
      await refresh()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    }
  }

  async function cancelJob(jobId: string) {
    const id = String(jobId || "").trim()
    if (!id) return
    try {
      await apiFetchJson(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" })
      toast.success(t("jobs.cancelRequestedToast"))
      await refresh()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
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
    redirectTo,
    exactStatusOptions,
    totalPages,
    safePageIndex,
    pageRows,
    statusLabel,
    formatDurationMs,
    jobDurationMs,
    setSearch: (next: string) => setState((prev) => ({ ...prev, qDraft: next })),
    setExactStatus: (next: string) => setState((prev) => ({ ...prev, exactStatus: next })),
    setSort: (next: JobsSortKey) => setState((prev) => ({ ...prev, sort: next })),
    setPageSize: (n: number) => setState((prev) => ({ ...prev, pageSize: normalizePageSize(n) })),
    setPageIndex: (n: number) => setState((prev) => ({ ...prev, pageIndex: Math.max(0, Math.floor(n)) })),
    refresh,
    copyText,
    resumeJob,
    cancelJob,
    onCreateOpenChange,
  }
}

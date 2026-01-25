"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  AlertCircle,
  Ban,
  Calendar,
  Circle,
  Clock,
  Clock3,
  Copy,
  ExternalLink,
  History,
  Layers,
  ListChecks,
  Play,
  RefreshCcw,
  Tag,
  Trash2,
  WorkflowIcon,
} from "lucide-react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"

import { useI18n } from "@/components/i18n-provider"
import { ErrorAlert } from "@/components/common/error-alert"
import { LoadingState } from "@/components/common/loading-state"
import { Button } from "@/components/ui/button"
import { ApiError, apiFetchJson } from "@/lib/shared/http/api"
import { useTopicStream } from "@/hooks/use-topic-stream"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { monotonicMerge } from "@/lib/shared/realtime/monotonic"
import { jobAttemptStatusUiSpec, jobStatusUiSpec, toCanonicalJobStatus } from "@/lib/shared/job-status"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { CopyableIdBadge } from "@/components/common/copyable-id-badge"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { StandardConfirmDialog, StandardDeleteDialog } from "@/components/common/standard-confirm-dialog"
import {
  calcDurationMs,
  formatAbsoluteTimeTitle,
  formatDurationMs,
  formatRelativeTimeFromNow,
} from "@/lib/shared/format/time"
import { formatPublicIdForDisplay } from "@/lib/shared/format/id"
import { JsonViewer } from "@/components/common/json-viewer"
import { FileViewer } from "@/components/common/file-viewer"
import { HeaderActions } from "@/components/common/header-actions"
import { HeaderSubbar } from "@/components/common/header-subbar"
import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { useTimezone } from "@/components/timezone-provider"
import { useStandardDialog } from "@/hooks/use-standard-dialog"
import { runStatusUiSpec, toCanonicalRunStatus, toUiRunStatus } from "@/lib/shared/run-status"
import { runControlAvailability } from "@/lib/shared/run-control"
import { jobControlAvailability } from "@/lib/shared/job-control"
import { FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { FileViewerFile } from "@/components/common/file-viewer"
import { useIsMobile } from "@/hooks/use-mobile"
import { TwoColumnSplitPanel } from "@/components/common/two-column-split-panel"
import { JobAttemptsSkeleton } from "@/components/jobs/detail/job-detail-skeletons"
import { StatusCollapsibleCard } from "@/components/common/status-collapsible-card"
import { KeyValueGrid } from "@/components/common/key-value-grid"
import { TwoLineMiniCard } from "@/components/common/two-line-mini-card"
import { PageLoadError } from "@/components/common/page-load-error"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { resolveJobDisplayError } from "@/lib/shared/error-display/adapters/job"
import { resolveAttemptDisplayError } from "@/lib/shared/error-display/adapters/attempt"
import { isRecord } from "@/lib/shared/lang/is-record"
import { safeJsonParse } from "@/lib/shared/lang/safe-json"
import { normalizeFilenameStem } from "@/lib/shared/filename"

type JobInputFileRow = {
  id: string
  name: string
  source: string
  status: string
  url: string | null
  error: string | null
  sha256: string | null
  sizeBytes: number | null
  mime: string | null
}

type Job = {
  id: string
  publicId?: string
  publicNumber?: number
  status: string
  cancelRequestedAt?: string | null
  cancelRequestedReason?: string | null
  workflowId: string
  workflow?: { id: string; publicId?: string; publicNumber?: number; name: string } | null
  pinnedWorkflowVersionId?: string | null
  pinnedWorkflowVersion?: { id: string; version: number; createdAt: string } | null
  scheduleId?: string | null
  schedule?: {
    id: string
    name?: string | null
    kind?: string | null
    cron?: string | null
    timezone?: string | null
    intervalMs?: number | null
    pinnedWorkflowVersionId?: string | null
    nextRunAt?: string | null
    lastRunAt?: string | null
  } | null
  batchId?: string | null
  batch?: {
    id: string
    name?: string | null
    status?: string | null
    startedAt?: string | null
    finishedAt?: string | null
  } | null
  runId?: string | null
  run?: {
    id: string
    publicId?: string
    publicNumber?: number
    status: string
    cancelRequestedAt?: string | null
    cancelRequestedReason?: string | null
    workflowVersionId?: string | null
    workflowVersionNumber?: number | null
  } | null
  scheduledFor?: string | null
  inputJson?: string | null
  claimedBy?: string | null
  claimedAt?: string | null
  leaseExpiresAt?: string | null
  attemptCount?: number | null
  maxAttempts?: number | null
  nextAttemptAt?: string | null
  queuedAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
  lastErrorMetaJson?: string | null
  lastErrorAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type JobAttempt = {
  id: string
  jobRunId: string
  attemptNo: number
  status: string
  runId: string | null
  run?: { id: string; status: string } | null
  errorCode: string | null
  errorMessage: string | null
  errorMetaJson: string | null
  errorAt: string | null
  startedAt: string
  finishedAt: string | null
}

type Run = {
  id: string
  publicId?: string
  publicNumber?: number
  status: string
  cancelRequestedAt?: string | null
  cancelRequestedReason?: string | null
  workflowVersionNumber?: number | null
  createdAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  // Optional monotonic version fields from SSE payloads (per-run topic enriches `ts`)
  ts?: string | null
}

function statusLabel(t: (k: string, vars?: Record<string, string | number>) => string, s: string) {
  const canon = toCanonicalJobStatus(s)
  if (canon === "QUEUED") return t("common.statusValues.queued")
  if (canon === "PAUSED") return t("common.statusValues.paused")
  if (canon === "RUNNING") return t("common.statusValues.running")
  if (canon === "CANCELING") return t("common.statusValues.canceling")
  if (canon === "SUCCEEDED") return t("common.statusValues.succeeded")
  if (canon === "FAILED") return t("common.statusValues.failed")
  if (canon === "CANCELED") return t("common.statusValues.canceled")
  return canon || "—"
}

function triggerLabel(t: (k: string, vars?: Record<string, string | number>) => string, job: Job | null) {
  const hasSchedule = !!(job?.scheduleId && String(job.scheduleId).trim())
  const hasBatch = !!(job?.batchId && String(job.batchId).trim())
  if (hasSchedule) return t("jobs.list.triggerSchedule")
  if (hasBatch) return t("jobs.list.triggerBatch")
  return t("common.source.manual")
}

function runStatusLabel(t: (k: string, vars?: Record<string, string | number>) => string, status: string) {
  const s = toCanonicalRunStatus(status)
  if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
  if (s === "FAILED") return t("common.statusValues.failed")
  if (s === "RUNNING") return t("common.statusValues.running")
  if (s === "CANCELING") return t("common.statusValues.canceling")
  if (s === "PENDING_INPUTS") return t("common.statusValues.queuedInputs")
  if (s === "CANCELED") return t("common.statusValues.canceled")
  return s || "—"
}

export default function JobDetailPage() {
  const { t, locale, tErrorCode } = useI18n()
  const { effectiveTimezone } = useTimezone()
  const router = useRouter()
  const isMobile = useIsMobile()
  const params = useParams()
  const sp = useSearchParams()
  const jobId = typeof params?.jobId === "string" ? String(params.jobId) : ""

  const queryClient = useQueryClient()

  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deletePending, setDeletePending] = React.useState(false)
  const cancelJobDialog = useStandardDialog()
  const forceStopDialog = useStandardDialog()
  const [cancelReason, setCancelReason] = React.useState("")

  const lastAttemptsRefreshAtRef = React.useRef(0)

  const [runInitialInputRaw, setRunInitialInputRaw] = React.useState<string | null>(null)
  const [runInitialInputErr, setRunInitialInputErr] = React.useState<unknown>(null)
  const [runInitialInputLoading, setRunInitialInputLoading] = React.useState(false)
  const [runInitialInputCode, setRunInitialInputCode] = React.useState<string | null>(null)

  const jobQueryKey = React.useMemo(() => ["job", jobId] as const, [jobId])
  const jobQuery = useQuery({
    queryKey: jobQueryKey,
    enabled: !!jobId,
    queryFn: async () => {
      const j = await apiFetchJson<{ job?: Job }>(`/api/jobs/${jobId}`, { cache: "no-store" })
      return j.job ?? null
    },
    placeholderData: keepPreviousData,
  })
  const job = jobQuery.data ?? null
  const err = jobQuery.error ?? null
  const loading = jobQuery.isLoading && !jobQuery.data && !jobQuery.error
  const refreshing = jobQuery.isFetching && jobQuery.isFetched

  // Normalized Run entity:
  // - Job tells us the current runId.
  // - Run details (status/icon/timing/cancel) come from the Run cache keyed by runId.
  const currentRunId = job?.runId ? String(job.runId) : ""
  const runQueryKey = React.useMemo(() => ["run", currentRunId] as const, [currentRunId])
  const runQuery = useQuery<Run | null>({
    queryKey: runQueryKey,
    enabled: !!currentRunId,
    queryFn: async () => {
      // IMPORTANT (Scheme 1):
      // HTTP is the snapshot, SSE is the incremental source of truth. The snapshot can briefly lag behind
      // stream updates, so we merge with any existing cached stream state BEFORE returning.
      const prev = queryClient.getQueryData<Run | null>(runQueryKey) ?? null
      const r = await apiFetchJson<{ run?: Run }>(`/api/runs/${encodeURIComponent(currentRunId)}`, {
        cache: "no-store",
      })
      const fetched = r.run ?? null
      if (!fetched) return null
      if (!prev) return fetched

      const prevCanon = toCanonicalRunStatus(String(prev?.status ?? ""))
      const nextCanon = toCanonicalRunStatus(String(fetched?.status ?? ""))
      const isTerminal = (s: string) => s === "SUCCEEDED" || s === "FAILED" || s === "CANCELED"

      const merged: Run = { ...fetched }
      if (isTerminal(prevCanon) && !isTerminal(nextCanon)) {
        merged.status = prev.status
      }
      if (prev.cancelRequestedAt != null) merged.cancelRequestedAt = prev.cancelRequestedAt
      if (prev.cancelRequestedReason != null) merged.cancelRequestedReason = prev.cancelRequestedReason
      if (prev.ts != null) merged.ts = prev.ts
      return merged
    },
    // IMPORTANT: do not keep previous run's data when switching runId (prevents stale icon/status).
    placeholderData: undefined,
  })
  const run = runQuery.data ?? null

  const attemptsQueryKey = React.useMemo(() => ["job", jobId, "attempts"] as const, [jobId])
  const attemptsQuery = useQuery({
    queryKey: attemptsQueryKey,
    enabled: !!jobId,
    queryFn: async () => {
      const j = await apiFetchJson<{ attempts?: JobAttempt[] }>(`/api/jobs/${jobId}/attempts`, { cache: "no-store" })
      return Array.isArray(j.attempts) ? j.attempts : []
    },
    placeholderData: keepPreviousData,
  })
  const attempts = attemptsQuery.data ?? []
  const attemptsErr = attemptsQuery.error ?? null
  const attemptsLoading = attemptsQuery.isLoading && attemptsQuery.data === undefined && !attemptsQuery.error

  const jobInputFilesQueryKey = React.useMemo(() => ["job", jobId, "input-files"] as const, [jobId])
  const jobInputFilesQuery = useQuery<JobInputFileRow[]>({
    queryKey: jobInputFilesQueryKey,
    enabled: !!jobId,
    queryFn: async ({ signal }) => {
      try {
        const body = await apiFetchJson<unknown>(`/api/jobs/${encodeURIComponent(jobId)}/input-files`, {
          cache: "no-store",
          signal,
        })
        const b = isRecord(body) ? body : null
        const raw = b?.inputFiles
        const arr = Array.isArray(raw) ? (raw as unknown[]) : []
        return arr
          .map((x) => (isRecord(x) ? x : null))
          .filter((x): x is Record<string, unknown> => x != null)
          .map((x) => ({
            id: String(x.id ?? ""),
            name: String(x.name ?? ""),
            source: String(x.source ?? ""),
            status: String(x.status ?? ""),
            url: typeof x.url === "string" ? String(x.url) : null,
            error: typeof x.error === "string" ? String(x.error) : null,
            sha256: typeof x.sha256 === "string" ? String(x.sha256) : null,
            sizeBytes: typeof x.sizeBytes === "number" ? x.sizeBytes : null,
            mime: typeof x.mime === "string" ? String(x.mime) : null,
          }))
          .filter((f) => !!f.id)
      } catch (e) {
        if (e instanceof ApiError) return [] as JobInputFileRow[]
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  // Load run inputs in background (not needed for first paint).
  React.useEffect(() => {
    const runId = currentRunId ? String(currentRunId) : ""
    if (!runId) {
      setRunInitialInputRaw(null)
      setRunInitialInputErr(null)
      setRunInitialInputLoading(false)
      setRunInitialInputCode(null)
      return
    }
    const ac = new AbortController()
    setRunInitialInputLoading(true)
    void (async () => {
      try {
        const body = await apiFetchJson<unknown>(`/api/runs/${encodeURIComponent(runId)}/inputs`, {
          cache: "no-store",
          signal: ac.signal,
        })
        const b = isRecord(body) ? body : null
        const available = b?.available !== false && typeof b?.initialInput === "string"
        if (available) {
          setRunInitialInputRaw(String(b?.initialInput ?? ""))
          setRunInitialInputCode(null)
        } else {
          setRunInitialInputRaw(null)
          const code = typeof b?.code === "string" ? String(b.code) : null
          setRunInitialInputCode(code)
        }
        setRunInitialInputErr(null)
      } catch (e) {
        if (ac.signal.aborted) return
        setRunInitialInputErr(e)
        setRunInitialInputRaw(null)
        setRunInitialInputCode(e instanceof ApiError ? e.code : null)
      } finally {
        if (!ac.signal.aborted) setRunInitialInputLoading(false)
      }
    })()
    return () => ac.abort()
  }, [currentRunId])

  // Run stream updates (job_state doesn't include nested run status, so the UI can briefly show
  // Job=FAILED while Run still looks RUNNING until the next HTTP refetch).
  useTopicStream({
    topic: currentRunId ? makeStreamTopic("run", String(currentRunId)) : null,
    enabled: !!currentRunId,
    persistCursor: false,
    onMessage: (msg) => {
      const type = String(msg.type || "")
      if (type !== "run_status" && type !== "run_cancel_requested" && type !== "run_force_stop_requested") return
      const data = msg.data && typeof msg.data === "object" ? (msg.data as Record<string, unknown>) : {}
      const msgRunId = typeof data.runId === "string" ? String(data.runId) : ""
      const curRunId = currentRunId ? String(currentRunId) : ""
      if (!curRunId || !msgRunId || msgRunId !== curRunId) return

      // Patch normalized Run cache (single source of truth for run status/icon).
      const prev = queryClient.getQueryData<Run | null>(runQueryKey) ?? null
      queryClient.setQueryData(runQueryKey, (cur) => {
        const base = (cur ?? prev) as Run | null
        const seed: Run =
          base ??
          ({
            id: curRunId,
            status: "",
            cancelRequestedAt: null,
            cancelRequestedReason: null,
            ts: null,
          } as Run)

        const patch: Partial<Run> = {}
        // Preserve SSE ordering/version info when available (used by monotonicMerge default getVersion via `ts`).
        if (typeof data.ts === "string") patch.ts = String(data.ts)

        if (type === "run_status") {
          const nextStatus = typeof data.status === "string" ? String(data.status) : ""
          if (nextStatus) patch.status = nextStatus
        }
        if (type === "run_cancel_requested") {
          if (typeof data.cancelRequestedAt === "string" || data.cancelRequestedAt == null)
            patch.cancelRequestedAt = data.cancelRequestedAt as string | null
          if (typeof data.reason === "string" || data.reason == null)
            patch.cancelRequestedReason = data.reason as string | null
        }

        return monotonicMerge(seed, patch, {
          getStatus: (x) => toCanonicalRunStatus(String((x as { status?: unknown } | null)?.status ?? "")),
          terminalStatuses: ["SUCCEEDED", "FAILED", "CANCELED"],
        })
      })

      if (type === "run_status") {
        const st = typeof data.status === "string" ? String(data.status) : ""
        const canon = toCanonicalRunStatus(st)
        if (canon === "SUCCEEDED" || canon === "FAILED" || canon === "CANCELED") {
          void queryClient.invalidateQueries({ queryKey: runQueryKey })
        }
      }
    },
  })

  // Run stream updates: keep Job inputs in sync with SSOT (InputFile).
  useTopicStream({
    topic: currentRunId ? makeStreamTopic("run", String(currentRunId)) : null,
    enabled: !!currentRunId,
    persistCursor: false,
    onMessage: (msg) => {
      const type = String(msg.type || "")
      if (type !== "input_file_status") return
      const data = msg.data && typeof msg.data === "object" ? (msg.data as Record<string, unknown>) : {}
      const msgRunId = typeof data.runId === "string" ? String(data.runId) : ""
      const curRunId = currentRunId ? String(currentRunId) : ""
      if (!curRunId || !msgRunId || msgRunId !== curRunId) return
      const fileId = typeof data.fileId === "string" ? String(data.fileId) : ""
      if (!fileId) return

      queryClient.setQueryData(jobInputFilesQueryKey, (prev) => {
        const list = Array.isArray(prev) ? (prev as JobInputFileRow[]) : []
        const idx = list.findIndex((x) => String(x?.id ?? "") === fileId)
        if (idx < 0) return prev
        const cur = list[idx]
        const nextStatus =
          typeof data.status === "string" ? String(data.status).toUpperCase() : String(cur.status ?? "")
        const patch: Partial<JobInputFileRow> = {
          status: nextStatus,
          error: typeof data.error === "string" ? String(data.error) : data.error === null ? null : cur.error,
          sha256: typeof data.sha256 === "string" ? String(data.sha256) : data.sha256 === null ? null : cur.sha256,
          sizeBytes:
            typeof data.sizeBytes === "number" ? data.sizeBytes : data.sizeBytes === null ? null : cur.sizeBytes,
          mime: typeof data.mime === "string" ? String(data.mime) : data.mime === null ? null : cur.mime,
        }
        const next = [...list]
        next[idx] = { ...cur, ...patch }
        return next
      })
    },
  })

  useTopicStream({
    topic: jobId ? makeStreamTopic("job", jobId) : null,
    enabled: !!jobId,
    onMessage: (msg) => {
      if (msg.type !== "job_state") return
      const d = msg.data && typeof msg.data === "object" ? (msg.data as Record<string, unknown>) : null
      if (!d) return
      if (String(d.jobId ?? "") !== String(jobId)) return
      const prev = queryClient.getQueryData<Job | null>(jobQueryKey) ?? null
      queryClient.setQueryData(jobQueryKey, (cur) => {
        const base = (cur ?? prev) as Job | null
        if (!base) return base
        const patch: Partial<Job> = {}
        if (typeof d.status === "string") patch.status = String(d.status)
        if (typeof d.cancelRequestedAt === "string" || d.cancelRequestedAt == null)
          patch.cancelRequestedAt = d.cancelRequestedAt as string | null
        if (typeof d.cancelRequestedReason === "string" || d.cancelRequestedReason == null)
          patch.cancelRequestedReason = d.cancelRequestedReason as string | null
        if (typeof d.pinnedWorkflowVersionId === "string" || d.pinnedWorkflowVersionId == null)
          patch.pinnedWorkflowVersionId = d.pinnedWorkflowVersionId as string | null
        if (typeof d.scheduledFor === "string" || d.scheduledFor == null)
          patch.scheduledFor = d.scheduledFor as string | null
        if (typeof d.queuedAt === "string") patch.queuedAt = String(d.queuedAt)
        if (typeof d.startedAt === "string") patch.startedAt = String(d.startedAt)
        if (typeof d.finishedAt === "string") patch.finishedAt = String(d.finishedAt)
        if (typeof d.attemptCount === "number") patch.attemptCount = d.attemptCount
        if (typeof d.maxAttempts === "number") patch.maxAttempts = d.maxAttempts
        if (typeof d.nextAttemptAt === "string") patch.nextAttemptAt = String(d.nextAttemptAt)
        if (typeof d.runId === "string" || d.runId == null) patch.runId = d.runId as string | null
        if (typeof d.lastErrorCode === "string" || d.lastErrorCode == null)
          patch.lastErrorCode = d.lastErrorCode as string | null
        if (typeof d.lastErrorMessage === "string" || d.lastErrorMessage == null)
          patch.lastErrorMessage = d.lastErrorMessage as string | null
        if (typeof d.lastErrorMetaJson === "string" || d.lastErrorMetaJson == null)
          patch.lastErrorMetaJson = d.lastErrorMetaJson as string | null
        if (typeof d.lastErrorAt === "string" || d.lastErrorAt == null)
          patch.lastErrorAt = d.lastErrorAt as string | null
        if (typeof d.scheduleId === "string" || d.scheduleId == null) patch.scheduleId = d.scheduleId as string | null
        if (typeof d.batchId === "string" || d.batchId == null) patch.batchId = d.batchId as string | null
        if (typeof d.claimedBy === "string" || d.claimedBy == null) patch.claimedBy = d.claimedBy as string | null
        if (typeof d.claimedAt === "string" || d.claimedAt == null) patch.claimedAt = d.claimedAt as string | null
        if (typeof d.leaseExpiresAt === "string" || d.leaseExpiresAt == null)
          patch.leaseExpiresAt = d.leaseExpiresAt as string | null
        if (typeof d.updatedAt === "string") patch.updatedAt = String(d.updatedAt)

        return monotonicMerge(base, patch, {
          versionKey: "updatedAt",
          getStatus: (x) => toCanonicalJobStatus(String((x as { status?: unknown } | null)?.status ?? "")),
          terminalStatuses: ["SUCCEEDED", "FAILED", "CANCELED"],
        })
      })

      const nextAttemptCount = typeof d.attemptCount === "number" ? d.attemptCount : (prev?.attemptCount ?? null)
      const prevAttemptCount = prev?.attemptCount ?? null
      const nextStatus = typeof d.status === "string" ? d.status : (prev?.status ?? "")
      const canonNextStatus = toCanonicalJobStatus(String(nextStatus ?? ""))
      const canonPrevStatus = toCanonicalJobStatus(String(prev?.status ?? ""))
      const terminalJob =
        canonNextStatus === "SUCCEEDED" || canonNextStatus === "FAILED" || canonNextStatus === "CANCELED"
      const statusChanged = canonNextStatus !== canonPrevStatus

      const shouldRefreshAttempts =
        (typeof nextAttemptCount === "number" &&
          (typeof prevAttemptCount !== "number" || nextAttemptCount !== prevAttemptCount)) ||
        terminalJob ||
        // Critical: on "FAILED -> QUEUED (retry pending)" transitions, attemptCount may not change,
        // but attempt #1 status should flip from RUNNING->FAILED. Refresh attempts on status changes.
        statusChanged

      if (!shouldRefreshAttempts) return
      const now = Date.now()
      if (now - lastAttemptsRefreshAtRef.current < 1500) return
      lastAttemptsRefreshAtRef.current = now
      void queryClient.invalidateQueries({ queryKey: attemptsQueryKey })
    },
  })

  // When created from "New Run", we want to land on the Run detail page as soon as it's created.
  React.useEffect(() => {
    if (!currentRunId) return
    if (sp.get("redirect") !== "run") return
    router.replace(`/runs/${currentRunId}`)
  }, [currentRunId, router, sp])

  const canonStatus = toCanonicalJobStatus(String(job?.status ?? ""))
  const cancelRequestedAt = job?.cancelRequestedAt ?? run?.cancelRequestedAt ?? null
  const cancelRequestedReason = job?.cancelRequestedReason ?? run?.cancelRequestedReason ?? null
  const jobCtl = jobControlAvailability({
    canonicalJobStatus: canonStatus,
    jobCancelRequestedAtIso: job?.cancelRequestedAt ?? null,
    runCancelRequestedAtIso: run?.cancelRequestedAt ?? null,
    runStatus: run?.status ?? null,
  })
  const uiJobStatus = jobCtl.uiStatus
  const jobStatusUi = React.useMemo(() => jobStatusUiSpec(uiJobStatus), [uiJobStatus])
  const statusText = job ? statusLabel(t, uiJobStatus) : t("common.notFound")
  const titleText = job?.workflow?.name ?? t("nav.jobs")
  // `uiJobStatus` is already canonical because it is derived from `canonStatus` (or "CANCELING").
  const canonUiJobStatus = uiJobStatus

  const workflowVersionDisplay =
    run?.workflowVersionNumber != null
      ? `v${String(run.workflowVersionNumber)}`
      : job?.pinnedWorkflowVersion?.version != null
        ? `v${String(job.pinnedWorkflowVersion.version)}`
        : "—"

  const uiRunStatusText = React.useMemo(() => {
    const raw = run?.status ? String(run.status) : ""
    if (!raw) return "—"
    return runStatusLabel(t, String(toUiRunStatus(raw, run?.cancelRequestedAt)))
  }, [run?.cancelRequestedAt, run?.status, t])

  const uiRunStatus = React.useMemo(() => {
    const raw = run?.status ? String(run.status) : ""
    if (!raw) return ""
    return String(toUiRunStatus(raw, run?.cancelRequestedAt))
  }, [run?.cancelRequestedAt, run?.status])

  const uiRunStatusSpec = React.useMemo(() => runStatusUiSpec(uiRunStatus), [uiRunStatus])

  const queueDelayMs = React.useMemo(
    () => calcDurationMs(job?.queuedAt ?? null, job?.startedAt ?? null),
    [job?.queuedAt, job?.startedAt],
  )
  const runDurationMs = React.useMemo(
    () => calcDurationMs(job?.startedAt ?? null, job?.finishedAt ?? null),
    [job?.startedAt, job?.finishedAt],
  )

  const leaseRemainingMs = React.useMemo(() => {
    if (!job?.leaseExpiresAt) return null
    const ts = new Date(job.leaseExpiresAt).getTime()
    if (Number.isNaN(ts)) return null
    const ms = ts - Date.now()
    return Number.isFinite(ms) ? ms : null
  }, [job?.leaseExpiresAt])

  const parsedJobInput = React.useMemo(() => safeJsonParse(job?.inputJson ?? null), [job?.inputJson])
  const parsedRunInput = React.useMemo(() => safeJsonParse(runInitialInputRaw), [runInitialInputRaw])
  const effectiveInput = parsedRunInput ?? parsedJobInput
  const inputParams = React.useMemo(() => {
    if (!effectiveInput || typeof effectiveInput !== "object" || Array.isArray(effectiveInput)) return null
    const x: Record<string, unknown> = { ...(effectiveInput as Record<string, unknown>) }
    if (Array.isArray(x.files)) delete x.files
    return x
  }, [effectiveInput])
  const inputFiles = React.useMemo(() => {
    return Array.isArray(jobInputFilesQuery.data) ? (jobInputFilesQuery.data as JobInputFileRow[]) : []
  }, [jobInputFilesQuery.data])

  const hasInputParams = !!(inputParams && Object.keys(inputParams).length)

  const bestError = React.useMemo(() => {
    const jobResolved = resolveJobDisplayError({
      errorCode: job?.lastErrorCode ?? null,
      errorMessage: job?.lastErrorMessage ?? null,
      errorMetaJson: job?.lastErrorMetaJson ?? null,
    })
    const jobDisplayCode = jobResolved.displayCode ? String(jobResolved.displayCode) : ""
    const jobWrapperCode = jobResolved.wrapperCode ? String(jobResolved.wrapperCode) : ""
    const jobWrapperMessage = jobResolved.wrapperMessage ? String(jobResolved.wrapperMessage) : ""
    if (jobDisplayCode || jobWrapperMessage || jobWrapperCode) {
      return {
        displayCode: jobDisplayCode || "UNKNOWN",
        wrapperCode: jobWrapperCode || null,
        wrapperMessage: jobWrapperMessage || null,
        meta: jobResolved.meta,
      }
    }

    // Fallback: most recent failed attempt with an error.
    const failed = [...(attempts ?? [])]
      .filter((a) => String(a?.status ?? "").toUpperCase() === "FAILED")
      .sort((a, b) => (Number(b?.attemptNo ?? 0) || 0) - (Number(a?.attemptNo ?? 0) || 0))
    const a = failed.find((x) => x?.errorCode || x?.errorMessage)
    if (!a) return null
    const resolved = resolveJobDisplayError({
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      errorMetaJson: a.errorMetaJson,
    })
    return {
      displayCode: String(resolved.displayCode ?? resolved.wrapperCode ?? "UNKNOWN"),
      wrapperCode: resolved.wrapperCode ? String(resolved.wrapperCode) : null,
      wrapperMessage: resolved.wrapperMessage ? String(resolved.wrapperMessage) : null,
      meta: resolved.meta,
    }
  }, [attempts, job?.lastErrorCode, job?.lastErrorMessage, job?.lastErrorMetaJson])

  const fileViewerFiles = React.useMemo(() => {
    const runId = currentRunId ? String(currentRunId) : ""
    const files = Array.isArray(inputFiles) ? inputFiles : []
    return files.map((f, idx: number) => {
      const id = String(f.id || idx)
      const name = String(f.name || t("runs.file"))
      const source = String(f.source ?? "")
      const status = String(f.status ?? "")
      const statusLower = status.toLowerCase()
      const url = typeof f.url === "string" ? String(f.url) : null
      const error = typeof f.error === "string" ? String(f.error) : null

      // Deterministic run-relative path when run exists and file is READY.
      const relPath = `uploads/${id}-${normalizeFilenameStem(name, { fallback: "file", maxLen: 120 })}`
      const downloadHref =
        runId && statusLower === "ready"
          ? `/api/runs/${encodeURIComponent(runId)}/files/download?path=${encodeURIComponent(relPath)}&name=${encodeURIComponent(name)}`
          : String(source).toLowerCase() === "url"
            ? null
            : url
      const canDownload = statusLower !== "fetching" && statusLower !== "failed" && !!downloadHref
      const out: FileViewerFile = {
        id,
        name,
        path: statusLower === "ready" ? relPath : null,
        url,
        source,
        status: statusLower,
        error,
        downloadHref,
        downloadDisabled: !canDownload,
        onRetryDownload: null,
        retryDisabled: true,
      }
      return out
    })
  }, [currentRunId, inputFiles, t])

  async function onCopyJobId() {
    try {
      await copyTextToClipboard(jobId)
      toast.success(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  async function onResumeJob() {
    try {
      await apiFetchJson(`/api/jobs/${jobId}/resume`, { method: "POST" })
      toast.success(t("common.jobEnqueuedToast"))
      void queryClient.invalidateQueries({ queryKey: jobQueryKey })
      void queryClient.invalidateQueries({ queryKey: attemptsQueryKey })
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    }
  }

  async function cancelJob(): Promise<boolean> {
    if (!jobId) return false
    try {
      const reason = cancelReason.trim()
      await apiFetchJson(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      })
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "runs.cancelFailed" }))
      return false
    }
    toast.success(t("runs.canceledToast"))
    void queryClient.invalidateQueries({ queryKey: jobQueryKey })
    void queryClient.invalidateQueries({ queryKey: attemptsQueryKey })
    return true
  }

  async function forceStopLinkedRun(): Promise<boolean> {
    const runId = currentRunId ? String(currentRunId) : ""
    if (!runId) return false
    try {
      await apiFetchJson(`/api/runs/${runId}/force-stop`, { method: "POST" })
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "runs.forceStopFailed" }))
      return false
    }
    toast.success(t("runs.forceStopToast"))
    void queryClient.invalidateQueries({ queryKey: jobQueryKey })
    void queryClient.invalidateQueries({ queryKey: attemptsQueryKey })
    return true
  }

  async function onDeleteJob() {
    if (!jobId) return
    setDeletePending(true)
    try {
      await apiFetchJson(`/api/jobs/${jobId}`, { method: "DELETE" })
      toast.success(t("jobs.deletedToast"))
      router.replace("/jobs")
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.deleteActionFailed" }))
    } finally {
      setDeletePending(false)
      setDeleteOpen(false)
    }
  }

  function fmtScheduleSummary(s: Job["schedule"]): string {
    if (!s) return "—"
    const kind = String(s.kind ?? "").toUpperCase()
    if (kind === "CRON") return `CRON: ${String(s.cron ?? "—")} (${String(s.timezone ?? "UTC")})`
    if (kind === "INTERVAL") {
      const ms = typeof s.intervalMs === "number" ? s.intervalMs : null
      return `INTERVAL: ${ms == null ? "—" : formatDurationMs(ms, { locale })}`
    }
    return kind || "—"
  }

  // First paint: render a full-page skeleton (match Runs/Workflows UX).
  if (loading && !job && !err) {
    return <LoadingState textKey="common.loading" spinner placement="top" minHeightClassName="min-h-[40vh]" />
  }

  // Main resource load failure: render a page-level error state (no top alert).
  if (err && !job) {
    return (
      <PageLoadError error={err} onRetry={() => void jobQuery.refetch()} backHref="/jobs" backLabelKey="nav.jobs" />
    )
  }

  const modalsNode = (
    <>
      <StandardDeleteDialog
        open={deleteOpen}
        onOpenChange={(o) => !deletePending && setDeleteOpen(o)}
        title={t("jobs.deleteJobTitle")}
        description={t("jobs.deleteJobDescription")}
        onConfirm={onDeleteJob}
        pending={deletePending}
      />
      <StandardConfirmDialog
        open={cancelJobDialog.open}
        onOpenChange={cancelJobDialog.onOpenChange}
        title={t("runs.cancelRunTitle")}
        description={
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">{t("runs.cancelRunDescription")}</div>
            <div className="grid gap-2">
              <FieldLabel htmlFor="job-cancel-reason">{t("runs.cancelReasonLabel")}</FieldLabel>
              <Input
                id="job-cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t("runs.cancelReasonPlaceholder")}
                maxLength={200}
              />
              <FieldDescription className="text-xs">{t("runs.cancelReasonHint")}</FieldDescription>
            </div>
          </div>
        }
        confirmText={t("runs.cancelRunAction")}
        confirmVariant="destructive"
        confirmIcon={<Ban className="h-4 w-4" aria-hidden="true" />}
        onConfirm={async () => {
          await cancelJobDialog.confirm(cancelJob)
        }}
        pending={cancelJobDialog.pending}
      />
      <StandardConfirmDialog
        open={forceStopDialog.open}
        onOpenChange={forceStopDialog.onOpenChange}
        title={t("runs.forceStopTitle")}
        description={t("runs.forceStopDescription")}
        confirmText={t("runs.forceStopAction")}
        confirmVariant="destructive"
        confirmIcon={<Ban className="h-4 w-4" aria-hidden="true" />}
        onConfirm={async () => {
          await forceStopDialog.confirm(forceStopLinkedRun)
        }}
        pending={forceStopDialog.pending}
      />
    </>
  )

  const headerProps = {
    title: (
      <div className="flex min-w-0 items-center gap-2">
        {job ? (
          <span
            className={cn("inline-flex shrink-0 items-center", jobStatusUi.varsClassName)}
            aria-label={statusLabel(t, uiJobStatus)}
            title={statusLabel(t, uiJobStatus)}
          >
            {jobStatusUi.Icon ? (
              <jobStatusUi.Icon
                aria-hidden="true"
                className={cn("size-5", jobStatusUi.iconClassName, jobStatusUi.textClassName)}
              />
            ) : null}
          </span>
        ) : null}
        <div className="min-w-0 truncate">{titleText}</div>
      </div>
    ),
    description: !job ? <span className="text-muted-foreground">{t("common.notFound")}</span> : null,
    right: (
      <HeaderActions
        iconOnlyBelow="md"
        overflow
        overflowAlign="end"
        sections={[
          {
            key: "main",
            items: [
              ...(["QUEUED", "PAUSED", "RUNNING"].includes(canonStatus)
                ? [
                    {
                      key: "cancel-job",
                      label: t("runs.cancelRunAction"),
                      icon: <Ban className="size-4" aria-hidden="true" />,
                      onClick: () => cancelJobDialog.openDialog(),
                      overflowOnly: true,
                      menuVariant: "destructive" as const,
                      disabled: Boolean(cancelJobDialog.pending || !jobCtl.canCancel),
                    },
                  ]
                : []),
              ...(() => {
                const runCanon = toCanonicalRunStatus(String(run?.status ?? ""))
                const rctl = runControlAvailability({
                  canonicalStatus: runCanon,
                  cancelRequestedAtIso: run?.cancelRequestedAt ?? null,
                })
                const show = rctl.showForceStop
                if (!show) return []
                return [
                  {
                    key: "force-stop-run",
                    label: t("runs.forceStopAction"),
                    icon: <Ban className="size-4" aria-hidden="true" />,
                    onClick: () => forceStopDialog.openDialog(),
                    overflowOnly: true,
                    menuVariant: "destructive" as const,
                    disabled: forceStopDialog.pending,
                  },
                ]
              })(),
              ...(job?.workflowId
                ? [
                    {
                      key: "open-workflow",
                      label: t("common.openActionWorkflowAction"),
                      icon: <ExternalLink className="size-4" aria-hidden="true" />,
                      href: `/workflows/${job.workflowId}`,
                      pinned: true,
                      variant: currentRunId ? ("secondary" as const) : ("default" as const),
                    },
                  ]
                : []),
              {
                key: "refresh",
                label: t("common.refreshAction"),
                icon: <RefreshCcw className="size-4" aria-hidden="true" />,
                onClick: () => void jobQuery.refetch(),
                overflowOnly: true,
              },
              {
                key: "copy-job-id",
                label: t("jobs.list.actions.copyJobIdAction"),
                icon: <Copy className="size-4" aria-hidden="true" />,
                onClick: () => void onCopyJobId(),
                overflowOnly: true,
              },
              ...(job?.scheduleId
                ? [
                    {
                      key: "open-schedule",
                      label: t("jobs.list.actions.openScheduleAction"),
                      icon: <ExternalLink className="size-4" aria-hidden="true" />,
                      href: `/schedules/${job.scheduleId}`,
                      overflowOnly: true,
                    },
                  ]
                : []),
              ...(job?.batchId
                ? [
                    {
                      key: "open-batch",
                      label: t("jobs.list.actions.openBatchAction"),
                      icon: <ExternalLink className="size-4" aria-hidden="true" />,
                      href: `/batches/${job.batchId}`,
                      overflowOnly: true,
                    },
                  ]
                : []),
              ...(job?.status === "PAUSED"
                ? [
                    {
                      key: "resume",
                      label: t("jobs.list.actions.startAction"),
                      icon: <Play className="size-4" aria-hidden="true" />,
                      onClick: () => void onResumeJob(),
                      overflowOnly: true,
                    },
                  ]
                : []),
              {
                key: "delete",
                label: t("common.deleteAction"),
                icon: <Trash2 className="size-4" aria-hidden="true" />,
                onClick: () => setDeleteOpen(true),
                overflowOnly: true,
                menuVariant: "destructive",
              },
            ],
          },
        ]}
      />
    ),
    bottom: (
      <HeaderSubbar hideAt="lg" className="flex-row items-center justify-between">
        {job ? (
          <HeaderSubbar.Left>
            <div className="text-base font-medium text-muted-foreground">
              {t("jobs.detail.subTitle", {
                trigger: triggerLabel(t, job),
                workflow: job?.workflow?.name ?? "—",
              })}
            </div>
            <CopyableIdBadge id={jobId} label={t("jobs.detail.jobId")} Icon={ListChecks} />
          </HeaderSubbar.Left>
        ) : null}
        {refreshing ? (
          <HeaderSubbar.Right>
            <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
          </HeaderSubbar.Right>
        ) : null}
      </HeaderSubbar>
    ),
  } satisfies React.ComponentProps<typeof StandardPageHeader>

  return (
    <DetailPageLayout modals={modalsNode} header={<StandardPageHeader {...headerProps} />}>
      {(() => {
        if (!job) return null

        if (canonUiJobStatus === "CANCELED") {
          const canceledUi = jobStatusUiSpec("CANCELED")
          const Icon = canceledUi.Icon ?? Clock
          return (
            <StatusCollapsibleCard
              icon={<Icon aria-hidden="true" className={cn(canceledUi.iconClassName, canceledUi.textClassName)} />}
              leftIconClassName={cn("h-4 w-4 shrink-0", canceledUi.varsClassName)}
              title={<span className="font-medium">{t("jobs.detail.cancellation")}</span>}
              summary={({ open }) =>
                open ? null : cancelRequestedReason ? <span>{String(cancelRequestedReason)}</span> : null
              }
              right={
                <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock3 className="h-4 w-4" aria-hidden="true" />
                  <span>{cancelRequestedAt ? formatRelativeTimeFromNow(cancelRequestedAt, { locale }) : "—"}</span>
                </div>
              }
              defaultOpen={false}
              toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
              className={cn("flex-none", canceledUi.varsClassName, canceledUi.containerClassName)}
              bodyClassName={canceledUi.borderClassName}
            >
              <div className="text-sm">{cancelRequestedReason ? String(cancelRequestedReason) : "—"}</div>
            </StatusCollapsibleCard>
          )
        }

        if (canonUiJobStatus === "FAILED") {
          const failedUi = jobStatusUiSpec("FAILED")
          const displayCode = bestError?.displayCode ? String(bestError.displayCode) : "UNKNOWN"
          const wrapperCode = bestError?.wrapperCode ? String(bestError.wrapperCode) : ""
          const wrapperMessage = bestError?.wrapperMessage ? String(bestError.wrapperMessage) : ""

          return (
            <StatusCollapsibleCard
              icon={<AlertCircle aria-hidden="true" className={cn("h-4 w-4", failedUi.textClassName)} />}
              leftIconClassName={cn("h-4 w-4 shrink-0", failedUi.varsClassName, failedUi.textClassName)}
              title={<span className="font-medium">{t("jobs.detail.lastError")}</span>}
              summary={({ open }) => (open ? null : <span>{displayCode}</span>)}
              defaultOpen={false}
              right={
                <div className="flex items-center gap-3">
                  {currentRunId ? (
                    <div className="inline-flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      <Link href={`/runs/${currentRunId}`}>{formatPublicIdForDisplay(String(currentRunId))}</Link>
                    </div>
                  ) : null}
                </div>
              }
              toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
              className={cn("flex-none", failedUi.varsClassName, failedUi.containerClassName)}
              bodyClassName={cn("space-y-2", failedUi.borderClassName)}
            >
              <KeyValueGrid>
                <KeyValueGrid.Row label="ERR_CODE" valueClassName="text-foreground">
                  {displayCode}
                </KeyValueGrid.Row>

                {bestError?.meta?.stepKey ? (
                  <KeyValueGrid.Row label="STEP">{String(bestError.meta.stepKey)}</KeyValueGrid.Row>
                ) : null}

                {wrapperCode || wrapperMessage ? (
                  <KeyValueGrid.Row label="MESSAGE">
                    {wrapperCode || "—"}
                    {wrapperMessage ? `: ${wrapperMessage}` : ""}
                  </KeyValueGrid.Row>
                ) : null}

                {bestError?.meta?.timeoutMs != null ? (
                  <KeyValueGrid.Row label="TIMEOUT">
                    {formatDurationMs(bestError.meta.timeoutMs, { locale })}
                  </KeyValueGrid.Row>
                ) : null}

                {bestError?.meta?.exitCode != null ? (
                  <KeyValueGrid.Row label="EXIT_CODE">{String(bestError.meta.exitCode)}</KeyValueGrid.Row>
                ) : null}
              </KeyValueGrid>
            </StatusCollapsibleCard>
          )
        }
        return null
      })()}

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard className="flex-none bg-card text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("common.overview")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TwoLineMiniCard
                title={t("jobs.detail.status")}
                titleRightClassName={cn(jobStatusUi.varsClassName, jobStatusUi.textClassName)}
                titleRight={
                  jobStatusUi.Icon ? (
                    <jobStatusUi.Icon className={cn("size-4", jobStatusUi.iconClassName)} aria-hidden="true" />
                  ) : null
                }
                value={statusText}
              />

              <TwoLineMiniCard
                title={t("jobs.detail.trigger")}
                titleRight={<Play className="size-4" aria-hidden="true" />}
                value={triggerLabel(t, job)}
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <TwoLineMiniCard
                title={t("common.fields.createdAt")}
                value={formatRelativeTimeFromNow(job?.createdAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(job?.createdAt ?? null, { locale, timeZone: effectiveTimezone })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("common.fields.updatedAt")}
                value={formatRelativeTimeFromNow(job?.updatedAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(job?.updatedAt ?? null, { locale, timeZone: effectiveTimezone })}
                valueClassName="font-mono text-sm"
              />
              {job?.workflowId ? (
                <TwoLineMiniCard
                  href={`/workflows/${String(job.workflowId)}`}
                  title={t("common.entities.workflow")}
                  titleRight={<WorkflowIcon className="size-4" aria-hidden="true" />}
                  value={String(job?.workflow?.name ?? formatPublicIdForDisplay(job?.workflow?.publicId ?? "") ?? "—")}
                  valueRight={<span className="font-mono text-xs">{workflowVersionDisplay}</span>}
                />
              ) : (
                <TwoLineMiniCard
                  title={t("common.entities.workflow")}
                  titleRight={<WorkflowIcon className="size-4" aria-hidden="true" />}
                  value={String(job?.workflow?.name ?? "—")}
                />
              )}
              {currentRunId ? (
                <TwoLineMiniCard
                  href={`/runs/${currentRunId}`}
                  title={t("jobs.detail.runStatus")}
                  titleRight={
                    uiRunStatusSpec?.Icon ? (
                      <uiRunStatusSpec.Icon
                        className={cn(
                          "size-4",
                          uiRunStatusSpec.iconClassName,
                          uiRunStatusSpec.varsClassName,
                          uiRunStatusSpec.textClassName,
                        )}
                        aria-hidden="true"
                      />
                    ) : (
                      <Play className="size-4" aria-hidden="true" />
                    )
                  }
                  value={formatPublicIdForDisplay(currentRunId)}
                  valueClassName="font-mono text-sm"
                />
              ) : (
                <TwoLineMiniCard
                  title={t("jobs.detail.runStatus")}
                  titleRight={<Play className="size-4" aria-hidden="true" />}
                  value="—"
                  valueClassName="font-mono text-sm"
                />
              )}
            </div>

            {/* Failure summary is shown in a dedicated card above; avoid duplicating noisy red blocks here. */}
          </SectionCardBody>
        </SectionCard>

        <SectionCard className="flex-none bg-card text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("jobs.detail.timing")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3">
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { k: "scheduledFor", label: t("jobs.detail.scheduledFor"), iso: job?.scheduledFor ?? null },
                { k: "queuedAt", label: t("jobs.detail.queuedAt"), iso: job?.queuedAt ?? null },
                { k: "startedAt", label: t("jobs.detail.startedAt"), iso: job?.startedAt ?? null },
                { k: "finishedAt", label: t("jobs.detail.finishedAt"), iso: job?.finishedAt ?? null },
              ].map((it) => (
                <TwoLineMiniCard
                  key={it.k}
                  title={it.label}
                  value={formatRelativeTimeFromNow(it.iso, { locale })}
                  valueTitle={formatAbsoluteTimeTitle(it.iso, { locale, timeZone: effectiveTimezone })}
                  valueClassName="font-mono text-sm"
                />
              ))}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <TwoLineMiniCard
                title={t("jobs.detail.queueDelay")}
                titleRight={<Calendar className="size-4" aria-hidden="true" />}
                value={queueDelayMs == null ? "—" : formatDurationMs(queueDelayMs, { locale })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("common.duration")}
                titleRight={<Clock3 className="size-4" aria-hidden="true" />}
                value={runDurationMs == null ? "—" : formatDurationMs(runDurationMs, { locale })}
                valueClassName="font-mono text-sm"
              />
            </div>
          </SectionCardBody>
        </SectionCard>

        <SectionCard className="flex-none bg-card text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("jobs.detail.leaseAndRetry")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <TwoLineMiniCard
                title={t("jobs.detail.attempts")}
                titleRight={<History className="size-4" aria-hidden="true" />}
                value={`${String(job?.attemptCount ?? 0)}/${String(job?.maxAttempts ?? "—")}`}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("jobs.detail.nextAttemptAt")}
                titleRight={<Clock3 className="size-4" aria-hidden="true" />}
                value={formatRelativeTimeFromNow(job?.nextAttemptAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(job?.nextAttemptAt ?? null, {
                  locale,
                  timeZone: effectiveTimezone,
                })}
                valueClassName="font-mono text-sm"
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <TwoLineMiniCard
                title={t("jobs.detail.claimedBy")}
                value={job?.claimedBy ? String(job.claimedBy) : "—"}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("jobs.detail.claimedAt")}
                value={formatRelativeTimeFromNow(job?.claimedAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(job?.claimedAt ?? null, { locale, timeZone: effectiveTimezone })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("jobs.detail.leaseExpiresAt")}
                value={formatRelativeTimeFromNow(job?.leaseExpiresAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(job?.leaseExpiresAt ?? null, {
                  locale,
                  timeZone: effectiveTimezone,
                })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("jobs.detail.leaseRemaining")}
                value={leaseRemainingMs == null ? "—" : formatDurationMs(Math.max(0, leaseRemainingMs), { locale })}
                valueClassName="font-mono text-sm"
              />
            </div>
          </SectionCardBody>
        </SectionCard>

        <SectionCard className="flex-none bg-card text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("jobs.detail.related")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3">
            <div className="grid gap-3 md:grid-cols-2">
              {job?.scheduleId ? (
                <TwoLineMiniCard
                  href={`/schedules/${job.scheduleId}`}
                  title={t("jobs.detail.schedule")}
                  titleRight={<Calendar className="size-4" aria-hidden="true" />}
                  value={formatPublicIdForDisplay(job.scheduleId)}
                  valueClassName="font-mono text-sm"
                />
              ) : (
                <TwoLineMiniCard
                  title={t("jobs.detail.schedule")}
                  titleRight={<Calendar className="size-4" aria-hidden="true" />}
                  value="—"
                  valueClassName="font-mono text-sm"
                />
              )}
              {job?.batchId ? (
                <TwoLineMiniCard
                  href={`/batches/${job.batchId}`}
                  title={t("jobs.detail.batch")}
                  titleRight={<Layers className="size-4" aria-hidden="true" />}
                  value={formatPublicIdForDisplay(job.batchId)}
                  valueClassName="font-mono text-sm"
                />
              ) : (
                <TwoLineMiniCard
                  title={t("jobs.detail.batch")}
                  titleRight={<Layers className="size-4" aria-hidden="true" />}
                  value="—"
                  valueClassName="font-mono text-sm"
                />
              )}
            </div>

            {job?.scheduleId ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <TwoLineMiniCard
                  title={t("jobs.detail.scheduleName")}
                  value={job?.schedule?.name ? String(job.schedule.name) : "—"}
                />
                <TwoLineMiniCard
                  title={t("common.scheduleRule")}
                  value={fmtScheduleSummary(job?.schedule ?? null)}
                  valueTitle={job?.schedule ? fmtScheduleSummary(job.schedule) : undefined}
                  valueClassName="font-mono text-sm"
                />
                <TwoLineMiniCard
                  title={t("jobs.detail.scheduleNextRunAt")}
                  value={formatRelativeTimeFromNow(job?.schedule?.nextRunAt ?? null, { locale })}
                  valueTitle={formatAbsoluteTimeTitle(job?.schedule?.nextRunAt ?? null, {
                    locale,
                    timeZone: effectiveTimezone,
                  })}
                  valueClassName="font-mono text-sm"
                />
                <TwoLineMiniCard
                  title={t("jobs.detail.scheduleLastRunAt")}
                  value={formatRelativeTimeFromNow(job?.schedule?.lastRunAt ?? null, { locale })}
                  valueTitle={formatAbsoluteTimeTitle(job?.schedule?.lastRunAt ?? null, {
                    locale,
                    timeZone: effectiveTimezone,
                  })}
                  valueClassName="font-mono text-sm"
                />
              </div>
            ) : null}

            {job?.batchId ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <TwoLineMiniCard
                  title={t("jobs.detail.batchName")}
                  value={job?.batch?.name ? String(job.batch.name) : "—"}
                />
                <TwoLineMiniCard
                  title={t("jobs.detail.batchStatus")}
                  value={job?.batch?.status ? String(job.batch.status) : "—"}
                  valueClassName="font-mono text-sm"
                />
                <TwoLineMiniCard
                  title={t("jobs.detail.batchStartedAt")}
                  value={formatRelativeTimeFromNow(job?.batch?.startedAt ?? null, { locale })}
                  valueTitle={formatAbsoluteTimeTitle(job?.batch?.startedAt ?? null, {
                    locale,
                    timeZone: effectiveTimezone,
                  })}
                  valueClassName="font-mono text-sm"
                />
                <TwoLineMiniCard
                  title={t("jobs.detail.batchFinishedAt")}
                  value={formatRelativeTimeFromNow(job?.batch?.finishedAt ?? null, { locale })}
                  valueTitle={formatAbsoluteTimeTitle(job?.batch?.finishedAt ?? null, {
                    locale,
                    timeZone: effectiveTimezone,
                  })}
                  valueClassName="font-mono text-sm"
                />
              </div>
            ) : null}
          </SectionCardBody>
        </SectionCard>
      </div>

      <SectionCard className="flex-none bg-card text-card-foreground">
        <SectionCardHeader>
          <div className="text-sm font-medium">{t("jobs.detail.attemptsTitle")}</div>
        </SectionCardHeader>
        <SectionCardBody className="p-3">
          {attemptsErr ? <ErrorAlert titleKey="common.loadFailed" error={attemptsErr} /> : null}
          {attemptsLoading ? (
            <JobAttemptsSkeleton rows={3} />
          ) : !attempts.length ? (
            <div className="text-base text-muted-foreground">—</div>
          ) : (
            <div className="space-y-3">
              {attempts.map((a) => {
                const durMs = calcDurationMs(a.startedAt, a.finishedAt)
                const canonAttemptStatus = String(a.status || "").toUpperCase()
                const attemptUi = jobAttemptStatusUiSpec(canonAttemptStatus)

                const isFailed = canonAttemptStatus === "FAILED"
                const resolvedAttemptError = resolveAttemptDisplayError({
                  errorCode: a.errorCode,
                  errorMessage: a.errorMessage,
                  errorMetaJson: a.errorMetaJson,
                })
                const hasErrorSummary =
                  isFailed && Boolean(resolvedAttemptError.displayCode || a.errorCode || a.errorMessage)
                const displayCode = hasErrorSummary
                  ? String(resolvedAttemptError.displayCode ?? a.errorCode ?? "UNKNOWN")
                  : ""
                const wrapperCode = hasErrorSummary
                  ? String(resolvedAttemptError.wrapperCode ?? a.errorCode ?? "UNKNOWN")
                  : ""
                const wrapperMsg =
                  hasErrorSummary && resolvedAttemptError.wrapperMessage
                    ? String(resolvedAttemptError.wrapperMessage)
                    : ""

                const Icon = attemptUi.Icon ?? Circle
                const leftIconNode = <Icon aria-hidden="true" />

                return (
                  <StatusCollapsibleCard
                    key={a.id}
                    icon={leftIconNode}
                    leftIconClassName={cn(
                      "h-4 w-4 shrink-0",
                      attemptUi.iconClassName,
                      attemptUi.varsClassName,
                      attemptUi.textClassName,
                    )}
                    title={t("jobs.detail.jobAttemptLine", { attemptNo: a.attemptNo })}
                    summary={
                      hasErrorSummary
                        ? ({ open }) => (open ? t("jobs.detail.attemptErrorDetailsHint") : <span>{displayCode}</span>)
                        : null
                    }
                    right={({ open }) => (
                      <div className="flex items-center gap-3">
                        {a.runId ? (
                          <div className="inline-flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
                            <ExternalLink className="h-4 w-4" aria-hidden="true" />
                            <Link href={`/runs/${a.runId}`}>{formatPublicIdForDisplay(String(a.runId))}</Link>
                          </div>
                        ) : null}
                        {open ? null : (
                          <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Clock3 className="h-4 w-4" aria-hidden="true" />
                            <span>{durMs == null ? "—" : formatDurationMs(durMs, { locale })}</span>
                          </div>
                        )}
                      </div>
                    )}
                    defaultOpen={false}
                    toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                    bodyClassName="space-y-2"
                  >
                    <InlineItemRow
                      useBadge
                      wrap
                      items={[
                        {
                          key: "startedAt",
                          Icon: Clock3,
                          text: `${t("jobs.detail.startedAt")}: ${formatRelativeTimeFromNow(a.startedAt, { locale })}`,
                          title: String(a.startedAt),
                        },
                        {
                          key: "finishedAt",
                          Icon: Clock3,
                          text: `${t("jobs.detail.finishedAt")}: ${formatRelativeTimeFromNow(a.finishedAt, { locale })}`,
                          title: a.finishedAt ? String(a.finishedAt) : undefined,
                        },
                        {
                          key: "duration",
                          Icon: Clock3,
                          text: `${t("common.duration")}: ${durMs == null ? "—" : formatDurationMs(durMs, { locale })}`,
                        },
                      ]}
                    />
                    {hasErrorSummary ? (
                      <KeyValueGrid>
                        <KeyValueGrid.Row label="ERR_CODE" valueClassName="text-foreground">
                          {displayCode}
                        </KeyValueGrid.Row>

                        {resolvedAttemptError.meta?.stepKey ? (
                          <KeyValueGrid.Row label="STEP">{String(resolvedAttemptError.meta.stepKey)}</KeyValueGrid.Row>
                        ) : null}

                        {wrapperCode || wrapperMsg ? (
                          <KeyValueGrid.Row label="MESSAGE">
                            {wrapperCode || "—"}
                            {wrapperMsg ? `: ${wrapperMsg}` : ""}
                          </KeyValueGrid.Row>
                        ) : null}

                        {resolvedAttemptError.meta?.timeoutMs != null ? (
                          <KeyValueGrid.Row label="TIMEOUT">
                            {formatDurationMs(resolvedAttemptError.meta.timeoutMs, { locale })}
                          </KeyValueGrid.Row>
                        ) : null}

                        {resolvedAttemptError.meta?.exitCode != null ? (
                          <KeyValueGrid.Row label="EXIT_CODE">
                            {String(resolvedAttemptError.meta.exitCode)}
                          </KeyValueGrid.Row>
                        ) : null}
                      </KeyValueGrid>
                    ) : null}
                  </StatusCollapsibleCard>
                )
              })}
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      <SectionCard className="flex-none bg-card text-card-foreground">
        <SectionCardHeader>
          <div className="text-sm font-medium">{t("common.inputs")}</div>
        </SectionCardHeader>
        <SectionCardBody>
          {runInitialInputErr ? <div className="text-sm text-muted-foreground">{t("common.loadFailed")}</div> : null}
          {toCanonicalRunStatus(String(run?.status ?? "")) === "PENDING_INPUTS" ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/10 p-3">
              <div className="text-sm text-muted-foreground">{t("jobs.detail.pendingInputsHint")}</div>
              {currentRunId ? (
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/runs/${currentRunId}`}>{t("jobs.detail.openRunToViewInputsAction")}</Link>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {(() => {
            const errorTextFromCode = (code: string | null | undefined) => {
              const c = typeof code === "string" ? code.trim() : ""
              if (!c) return null
              return tErrorCode(c) ?? c
            }

            const maybeErrorMsg =
              runInitialInputCode && runInitialInputCode !== "NO_RUN_INPUTS" ? (
                <div className="p-3 text-xs text-muted-foreground">
                  {errorTextFromCode(runInitialInputCode) ?? t("common.error")}
                </div>
              ) : null

            const noParamsMsg = <div className="p-3 text-xs text-muted-foreground">{t("runs.noParameters")}</div>
            const noFilesMsg = <div className="p-3 text-xs text-muted-foreground">{t("runs.noInputFiles")}</div>

            const paramsEmpty = maybeErrorMsg ?? noParamsMsg
            const filesEmpty = maybeErrorMsg ?? noFilesMsg

            return (
              <div className="h-[520px] min-h-0 overflow-hidden md:h-[420px]">
                <TwoColumnSplitPanel
                  isMobile={isMobile}
                  left={{
                    title: t("runs.parameters"),
                    content: (
                      <JsonViewer
                        value={hasInputParams ? (inputParams ?? {}) : null}
                        empty={hasInputParams ? null : paramsEmpty}
                      />
                    ),
                  }}
                  right={{
                    title: t("runs.inputFiles"),
                    content: (
                      <FileViewer files={fileViewerFiles} empty={fileViewerFiles.length > 0 ? null : filesEmpty} />
                    ),
                  }}
                />
              </div>
            )
          })()}
        </SectionCardBody>
      </SectionCard>
    </DetailPageLayout>
  )
}

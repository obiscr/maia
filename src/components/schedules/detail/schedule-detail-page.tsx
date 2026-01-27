"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { Calendar, Clock3, ExternalLink, Pencil, Play, Power, Trash2 } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { ErrorAlert } from "@/components/common/error-alert"
import { LoadingState } from "@/components/common/loading-state"
import { Button } from "@/components/ui/button"
import { apiFetchJson } from "@/lib/shared/http/api"
import { useTopicStream } from "@/hooks/use-topic-stream"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { monotonicMerge } from "@/lib/shared/realtime/monotonic"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { HeaderActions } from "@/components/common/header-actions"
import { scheduleStatusUiSpec } from "@/lib/shared/schedule-status"
import { scheduleToggleSpec } from "@/lib/shared/schedule-control"
import { cn } from "@/lib/utils"
import { JsonViewer } from "@/components/common/json-viewer"
import { StandardDeleteDialog } from "@/components/common/standard-confirm-dialog"
import { EditScheduleSheet } from "@/components/schedules/sheets/edit-schedule-sheet"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { JobsCommonListItem, type JobsListItemModel } from "@/components/jobs/list/jobs-common-list-item"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { clampInt } from "@/hooks/list-page-utils"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { useListQueryState } from "@/hooks/list-query/use-list-query-state"
import {
  formatAbsoluteTime,
  formatAbsoluteTimeTitle,
  formatDurationMs,
  formatRelativeTimeFromNow,
} from "@/lib/shared/format/time"
import { StandardListPage } from "@/components/common/standard-list-page"
import { toCanonicalJobStatus } from "@/lib/shared/job-status"
import { useJobsListFilters } from "@/components/jobs/hooks/use-jobs-list-filters"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { PageLoadError } from "@/components/common/page-load-error"
import { isRecord } from "@/lib/shared/lang/is-record"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { TwoLineMiniCard } from "@/components/common/two-line-mini-card"
import { useTimezone } from "@/components/timezone-provider"

type ScheduleKind = "CRON" | "INTERVAL"

type ScheduleDetail = {
  id: string
  name: string | null
  enabled: boolean
  workflowId: string | null
  workflow: { id: string; publicId: string; publicNumber: number; name: string } | null
  pinnedWorkflowVersion: { version: number; createdAt: string } | null
  kind: ScheduleKind
  cron: string | null
  timezone: string | null
  intervalMs: number | null
  misfirePolicy: string
  catchUpLimit: number | null
  overlapPolicy: string
  inputJson: string
  urlFiles?: Array<{ id: string; url: string; name: string }>
  nextRunAt: string | null
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

type JobsListDtoItem = {
  id: string
  workflowName: string | null
  status: string
  scheduledFor?: string | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  runId: string | null
  attemptCount: number
  maxAttempts: number
}

function toScheduleKind(v: string): ScheduleKind {
  return v === "INTERVAL" ? "INTERVAL" : "CRON"
}

export default function ScheduleDetailPage() {
  const { t, locale } = useI18n()
  const { effectiveTimezone } = useTimezone()
  const router = useRouter()
  const params = useParams<{ scheduleId: string }>()
  const scheduleId = String(params?.scheduleId ?? "")

  const DEFAULT_CATCH_UP_LIMIT = 100

  const [schedule, setSchedule] = React.useState<ScheduleDetail | null>(null)
  const [err, setErr] = React.useState<unknown>(null)
  const [loading, setLoading] = React.useState(true) // initial-only
  const [refreshing, setRefreshing] = React.useState(false)

  const [previewTimes, setPreviewTimes] = React.useState<string[]>([])
  const [previewErr, setPreviewErr] = React.useState<unknown>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)

  const searchInputRef = React.useRef<HTMLInputElement | null>(null)
  const JOBS_PAGE_SIZE = 50

  type JobsState = {
    qDraft: string
    q: string
    exactStatus: string
    sort: "CREATED_DESC" | "CREATED_ASC"
    pageIndex: number
  }

  const {
    state: jobsState,
    setState: setJobsState,
    didInit: jobsDidInit,
  } = useListQueryState<JobsState>({
    basePath: scheduleId ? `/schedules/${scheduleId}` : "/schedules",
    defaults: {
      qDraft: "",
      q: "",
      exactStatus: "ANY",
      sort: "CREATED_DESC",
      pageIndex: 0,
    },
    codec: {
      parse: (qp) => {
        const patch: Partial<JobsState> = {}
        const q = qp.get("q")
        if (typeof q === "string" && q.trim()) {
          patch.qDraft = q
          patch.q = q
        }
        const status = qp.get("status")
        if (typeof status === "string" && status.trim()) patch.exactStatus = status
        const sortRaw = qp.get("sort")
        if (sortRaw === "CREATED_ASC" || sortRaw === "CREATED_DESC") patch.sort = sortRaw

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
        if (s.pageIndex > 0) qp.set("page", String(s.pageIndex + 1))
        else qp.delete("page")
        return qp
      },
    },
    resetPageIndexDeps: [(s) => s.q, (s) => s.exactStatus, (s) => s.sort],
    onResetPageIndex: () => setJobsState((prev) => ({ ...prev, pageIndex: 0 })),
    urlMode: { strategy: "replaceState", kind: "replace" },
  })

  React.useEffect(() => {
    if (!jobsDidInit) return
    const tmr = window.setTimeout(() => {
      setJobsState((prev) => (prev.q === prev.qDraft ? prev : { ...prev, q: prev.qDraft }))
    }, 250)
    return () => window.clearTimeout(tmr)
  }, [jobsDidInit, jobsState.qDraft, setJobsState])

  const jobsQuery = useListQuery<{ jobs: JobsListDtoItem[]; total: number }>({
    queryKey: [
      "scheduleRecentJobs",
      {
        scheduleId,
        q: jobsState.q.trim(),
        exactStatus: jobsState.exactStatus,
        sort: jobsState.sort,
        pageIndex: jobsState.pageIndex,
        pageSize: JOBS_PAGE_SIZE,
      },
    ],
    enabled: !!scheduleId,
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams()
      qs.set("scheduleId", scheduleId)
      qs.set("page", String(jobsState.pageIndex + 1))
      qs.set("pageSize", String(JOBS_PAGE_SIZE))
      qs.set("sort", jobsState.sort)
      const q = jobsState.q.trim()
      if (q) qs.set("q", q)
      if (jobsState.exactStatus !== "ANY") qs.set("status", jobsState.exactStatus)
      return await apiFetchJson(`/api/jobs?${qs.toString()}`, { cache: "no-store", signal })
    },
  })

  const jobsDto = Array.isArray(jobsQuery.data?.jobs) ? (jobsQuery.data?.jobs as JobsListDtoItem[]) : []
  const jobsTotal = Number(jobsQuery.data?.total) || 0
  const jobs = React.useMemo<JobsListItemModel[]>(
    () =>
      jobsDto.map((it) => ({
        id: it.id,
        title: it.workflowName ?? "—",
        status: it.status,
        scheduledFor: it.scheduledFor ?? null,
        queuedAt: it.queuedAt,
        startedAt: it.startedAt,
        finishedAt: it.finishedAt,
        runId: it.runId,
        attemptCount: it.attemptCount,
        maxAttempts: it.maxAttempts,
      })),
    [jobsDto],
  )

  const jobsHasData = !!jobsQuery.data
  const jobsLoading = jobsQuery.isLoading && !jobsHasData
  const jobsRefreshing = jobsQuery.isFetching && jobsHasData
  const jobsErr = (jobsQuery.error ?? null) as unknown

  const totalPages = React.useMemo(() => Math.max(1, Math.ceil(jobsTotal / JOBS_PAGE_SIZE)), [jobsTotal])
  const safePageIndex = React.useMemo(
    () => Math.min(jobsState.pageIndex, totalPages - 1),
    [jobsState.pageIndex, totalPages],
  )
  React.useEffect(() => {
    if (!jobsDidInit) return
    if (jobsState.pageIndex !== safePageIndex) setJobsState((prev) => ({ ...prev, pageIndex: safePageIndex }))
  }, [jobsDidInit, jobsState.pageIndex, safePageIndex, setJobsState])

  const skeletonCount = Math.min(JOBS_PAGE_SIZE, 10)
  const { listItems } = useStableListRows({ rows: jobs, loading: jobsLoading, skeletonCount })

  const refreshJobs = React.useCallback(async () => {
    await jobsQuery.refetch()
  }, [jobsQuery])

  const search = jobsState.qDraft
  const setSearch = React.useCallback(
    (next: string) => setJobsState((prev) => ({ ...prev, qDraft: next })),
    [setJobsState],
  )
  const exactStatus = jobsState.exactStatus
  const setExactStatus = React.useCallback(
    (next: string) => setJobsState((prev) => ({ ...prev, exactStatus: next })),
    [setJobsState],
  )
  const sort = jobsState.sort
  const setSort = React.useCallback(
    (next: "CREATED_DESC" | "CREATED_ASC") => setJobsState((prev) => ({ ...prev, sort: next })),
    [setJobsState],
  )
  const setPageIndex = React.useCallback(
    (next: number) => setJobsState((prev) => ({ ...prev, pageIndex: next })),
    [setJobsState],
  )

  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deletePending, setDeletePending] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)

  const refreshSchedule = React.useCallback(
    async (opts?: { background?: boolean }) => {
      const background = opts?.background === true
      if (!background) setLoading(true)
      else setRefreshing(true)
      try {
        const j = await apiFetchJson<{ schedule?: ScheduleDetail }>(`/api/schedules/${scheduleId}`, {
          cache: "no-store",
        })
        setSchedule(j.schedule ?? null)
        setErr(null)
      } catch (e) {
        setErr(e)
      } finally {
        if (!background) setLoading(false)
        setRefreshing(false)
      }
    },
    [scheduleId],
  )

  const refreshPreview = React.useCallback(async () => {
    if (!scheduleId) return
    setPreviewLoading(true)
    try {
      const j = await apiFetchJson<{ times?: string[] }>(`/api/schedules/${scheduleId}/preview?limit=5`, {
        cache: "no-store",
      })
      const times = Array.isArray(j?.times) ? j.times.map((x) => String(x)) : []
      setPreviewTimes(times)
      setPreviewErr(null)
    } catch (e) {
      setPreviewErr(e)
    } finally {
      setPreviewLoading(false)
    }
  }, [scheduleId])

  React.useEffect(() => {
    void refreshSchedule()
    void refreshPreview()
  }, [refreshPreview, refreshSchedule])

  const refreshTmrRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    return () => {
      if (refreshTmrRef.current) window.clearTimeout(refreshTmrRef.current)
    }
  }, [])

  useTopicStream({
    topic: scheduleId ? makeStreamTopic("schedule", scheduleId) : null,
    enabled: !!scheduleId,
    onMessage: (msg) => {
      if (!msg?.type) return
      if (msg.type === "schedule_state") {
        const d = msg.data
        if (isRecord(d)) {
          setSchedule((prev) => {
            if (!prev) return prev
            const patch: Partial<ScheduleDetail> & Record<string, unknown> = {}
            if (typeof d.enabled === "boolean") patch.enabled = d.enabled
            if (typeof d.kind === "string") patch.kind = toScheduleKind(d.kind.toUpperCase())
            if (typeof d.cron === "string" || d.cron == null) patch.cron = d.cron as string | null
            if (typeof d.timezone === "string" || d.timezone == null) patch.timezone = d.timezone as string | null
            if (typeof d.intervalMs === "number" || d.intervalMs == null)
              patch.intervalMs = d.intervalMs as number | null
            if (typeof d.misfirePolicy === "string" || d.misfirePolicy == null)
              patch.misfirePolicy = String(d.misfirePolicy ?? patch.misfirePolicy ?? "")
            if (typeof d.catchUpLimit === "number" || d.catchUpLimit == null)
              patch.catchUpLimit = (d.catchUpLimit as number | null) ?? null
            if (typeof d.overlapPolicy === "string" || d.overlapPolicy == null)
              patch.overlapPolicy = String(d.overlapPolicy ?? patch.overlapPolicy ?? "")
            if (typeof d.nextRunAt === "string" || d.nextRunAt == null) patch.nextRunAt = d.nextRunAt as string | null
            if (typeof d.lastRunAt === "string" || d.lastRunAt == null) patch.lastRunAt = d.lastRunAt as string | null
            if (typeof d.updatedAt === "string") patch.updatedAt = d.updatedAt
            return monotonicMerge(prev, patch, { versionKey: "updatedAt" })
          })
        }
        return
      }
      if (msg.type === "job_state") {
        // A job fired/finished for this schedule; refresh derived fields (nextRunAt/lastRunAt) without polling.
        if (refreshTmrRef.current) window.clearTimeout(refreshTmrRef.current)
        refreshTmrRef.current = window.setTimeout(() => {
          void refreshSchedule({ background: true })
          void refreshPreview()
          void refreshJobs()
        }, 250)
      }
    },
  })

  const enabled = Boolean(schedule?.enabled)
  const scheduleStatusUi = React.useMemo(() => scheduleStatusUiSpec(enabled ? "ENABLED" : "DISABLED"), [enabled])
  const statusText = enabled ? t("schedules.statusEnabled") : t("schedules.statusDisabled")
  const titleText =
    (typeof schedule?.name === "string" && schedule.name.trim()) ||
    (typeof schedule?.workflow?.name === "string" && schedule.workflow.name.trim())
      ? String(schedule?.name?.trim() || schedule?.workflow?.name || "")
      : t("nav.schedules")

  function scheduleKindLabel(kind: unknown) {
    const k = String(kind ?? "").toUpperCase()
    if (k === "CRON") return t("schedules.kindCron")
    if (k === "INTERVAL") return t("schedules.kindInterval")
    return k || "—"
  }

  function misfirePolicyLabel(raw: unknown) {
    const v = String(raw ?? "").toUpperCase()
    if (v === "SKIP") return t("schedules.policies.misfire.SKIP")
    if (v === "CATCH_UP") return t("schedules.policies.misfire.CATCH_UP")
    return t("schedules.policies.misfire.FIRE_ONCE")
  }

  function overlapPolicyLabel(raw: unknown) {
    const v = String(raw ?? "").toUpperCase()
    if (v === "ALLOW") return t("schedules.policies.overlap.ALLOW")
    return t("schedules.policies.overlap.SKIP")
  }

  function pinnedWorkflowVersionLabel(s: ScheduleDetail | null) {
    const ver = s?.pinnedWorkflowVersion?.version
    if (typeof ver === "number" && Number.isFinite(ver)) return `v${String(ver)}`
    return t("schedules.policies.pinned.latest")
  }

  function catchUpLimitLabel(s: ScheduleDetail | null) {
    const misfire = String(s?.misfirePolicy ?? "").toUpperCase()
    if (misfire !== "CATCH_UP") return "—"
    if (s?.catchUpLimit == null) return t("schedules.policies.catchUpLimitDefault", { limit: DEFAULT_CATCH_UP_LIMIT })
    return String(s.catchUpLimit)
  }

  function jobStatusLabel(status: string) {
    const s = toCanonicalJobStatus(status)
    if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
    if (s === "FAILED") return t("common.statusValues.failed")
    if (s === "RUNNING") return t("common.statusValues.running")
    if (s === "PAUSED") return t("common.statusValues.paused")
    if (s === "QUEUED") return t("common.statusValues.queued")
    if (s === "CANCELED") return t("common.statusValues.canceled")
    return s || "—"
  }

  const exactStatusOptions = React.useMemo(() => {
    const known = ["QUEUED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]
    return ["ANY", ...known]
  }, [])

  const { filtersActive, clearFilters, renderFilters } = useJobsListFilters({
    t,
    search,
    setSearch,
    exactStatus,
    setExactStatus,
    exactStatusOptions,
    sort,
    setSort,
    setPageIndex,
    searchInputRef,
    statusLabel: jobStatusLabel,
  })

  const toggleSpec = React.useMemo(() => scheduleToggleSpec(enabled), [enabled])

  const actions = [
    {
      key: "runNow",
      label: t("schedules.runNowAction"),
      icon: <Play aria-hidden="true" />,
      onClick: () => void runNow(),
      pinned: true,
    },
    {
      key: "toggle",
      label: t(toggleSpec.labelKey),
      icon: <Power aria-hidden="true" />,
      onClick: () => void updateSchedule({ enabled: toggleSpec.nextEnabled }),
      variant: "secondary" as const,
    },
    {
      key: "edit",
      label: t("common.editAction"),
      icon: <Pencil aria-hidden="true" />,
      onClick: () => setEditOpen(true),
      variant: "secondary" as const,
    },
    {
      key: "delete",
      label: t("common.deleteAction"),
      icon: <Trash2 aria-hidden="true" />,
      onClick: () => setDeleteOpen(true),
      overflowOnly: true,
      menuVariant: "destructive" as const,
    },
  ] as const

  async function updateSchedule(
    patch: Partial<{
      name: string | null
      enabled: boolean
      kind: ScheduleKind
      cron: string | null
      timezone: string | null
      intervalMs: number | null
      misfirePolicy: "SKIP" | "FIRE_ONCE" | "CATCH_UP"
      catchUpLimit: number | null
      overlapPolicy: "SKIP" | "ALLOW"
      pinnedWorkflowVersionNumber: number | null
      inputJson: unknown
      urlFiles: Array<{ url: string }>
    }>,
  ) {
    if (!scheduleId) return
    try {
      await apiFetchJson(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch ?? {}),
      })
      toast.success(
        patch && typeof patch.enabled === "boolean"
          ? patch.enabled
            ? t("schedules.enabledToast")
            : t("schedules.disabledToast")
          : t("schedules.updatedToast"),
      )
      await refreshSchedule({ background: true })
      void refreshPreview()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.updateFailed" }))
    }
  }

  async function runNow() {
    if (!scheduleId) return
    try {
      await apiFetchJson(`/api/schedules/${scheduleId}/run-now`, { method: "POST" })
      toast.success(t("common.jobEnqueuedToast"))
      void refreshSchedule({ background: true })
      void refreshPreview()
      void refreshJobs()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "schedules.runNowActionFailed" }))
    }
  }

  async function doDelete() {
    if (!scheduleId || deletePending) return
    setDeletePending(true)
    try {
      await apiFetchJson(`/api/schedules/${scheduleId}`, { method: "DELETE" })
      toast.success(t("schedules.deletedToast"))
      router.replace("/schedules")
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.deleteActionFailed" }))
    } finally {
      setDeletePending(false)
      setDeleteOpen(false)
    }
  }

  const editModel = schedule
    ? {
        id: schedule.id,
        workflowId: schedule.workflow?.id ?? schedule.workflowId ?? null,
        workflowName: schedule.workflow?.name ?? null,
        name: schedule.name,
        enabled: Boolean(schedule.enabled),
        kind: toScheduleKind(String(schedule.kind).toUpperCase()),
        cron: schedule.cron,
        timezone: schedule.timezone,
        intervalMs: schedule.intervalMs,
        misfirePolicy: String(schedule.misfirePolicy ?? "FIRE_ONCE").toUpperCase() as "SKIP" | "FIRE_ONCE" | "CATCH_UP",
        catchUpLimit: schedule.catchUpLimit ?? null,
        overlapPolicy: String(schedule.overlapPolicy ?? "SKIP").toUpperCase() as "SKIP" | "ALLOW",
        pinnedWorkflowVersionNumber:
          typeof schedule.pinnedWorkflowVersion?.version === "number" ? schedule.pinnedWorkflowVersion.version : null,
        inputJson: schedule.inputJson ?? "{}",
        urlFiles: Array.isArray(schedule.urlFiles) ? schedule.urlFiles : [],
      }
    : null

  const cronExpr = String(schedule?.cron ?? "").trim() || "—"
  const cronTimezone = String(schedule?.timezone ?? "UTC")
  const intervalText = typeof schedule?.intervalMs === "number" ? `${schedule.intervalMs}ms` : "—"
  const scheduleText =
    schedule?.kind === "CRON"
      ? t("schedules.detail.scheduleTextCron", { expr: cronExpr, timezone: cronTimezone })
      : t("schedules.detail.scheduleTextInterval", { interval: intervalText })

  const inputJsonParsed = React.useMemo(() => {
    const raw = schedule?.inputJson
    if (raw == null) return null
    try {
      return JSON.parse(String(raw))
    } catch {
      return { raw: String(raw) }
    }
  }, [schedule?.inputJson])

  const modalsNode = (
    <>
      <StandardDeleteDialog
        open={deleteOpen}
        onOpenChange={(o) => !deletePending && setDeleteOpen(o)}
        title={t("schedules.deleteScheduleTitle")}
        description={t("schedules.deleteScheduleDescription")}
        onConfirm={doDelete}
        pending={deletePending}
      />
      <EditScheduleSheet
        open={editOpen}
        onOpenChange={(o) => setEditOpen(o)}
        schedule={editModel}
        onSave={async (_id, patch) => {
          let inputJsonPatch: unknown = undefined
          if (typeof patch.inputJson === "string") {
            try {
              const parsed = patch.inputJson.trim() ? JSON.parse(patch.inputJson) : {}
              inputJsonPatch = parsed
            } catch {
              toast.error(t("errors.INVALID_JSON"))
              return
            }
          }

          const misfirePolicy =
            typeof patch.misfirePolicy === "string"
              ? (String(patch.misfirePolicy).toUpperCase() as "SKIP" | "FIRE_ONCE" | "CATCH_UP")
              : undefined
          const overlapPolicy =
            typeof patch.overlapPolicy === "string"
              ? (String(patch.overlapPolicy).toUpperCase() as "SKIP" | "ALLOW")
              : undefined

          const pinnedWorkflowVersionNumber =
            patch.pinnedWorkflowVersionNumber === null
              ? null
              : typeof patch.pinnedWorkflowVersionNumber === "number"
                ? Math.floor(patch.pinnedWorkflowVersionNumber)
                : undefined

          await updateSchedule({
            name: typeof patch.name === "string" ? patch.name : (patch.name ?? null),
            enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
            kind: patch.kind,
            cron: patch.cron ?? null,
            timezone: patch.timezone ?? null,
            intervalMs: typeof patch.intervalMs === "number" ? patch.intervalMs : (patch.intervalMs ?? null),
            ...(misfirePolicy ? { misfirePolicy } : {}),
            ...(overlapPolicy ? { overlapPolicy } : {}),
            ...(misfirePolicy === "CATCH_UP" && typeof patch.catchUpLimit === "number"
              ? { catchUpLimit: Math.floor(patch.catchUpLimit) }
              : {}),
            ...(pinnedWorkflowVersionNumber !== undefined ? { pinnedWorkflowVersionNumber } : {}),
            inputJson: inputJsonPatch,
          })
        }}
      />
    </>
  )

  const headerProps = {
    title: (
      <div className="flex min-w-0 items-center gap-2">
        {scheduleStatusUi.Icon ? (
          <scheduleStatusUi.Icon
            aria-hidden="true"
            className={cn(
              "size-5 shrink-0",
              scheduleStatusUi.iconClassName,
              scheduleStatusUi.varsClassName,
              scheduleStatusUi.textClassName,
            )}
          />
        ) : null}
        <div className="min-w-0 truncate">{titleText}</div>
      </div>
    ),
    description: loading ? (
      <span className="text-muted-foreground">{t("common.loading")}</span>
    ) : schedule ? null : (
      <span className="text-muted-foreground">{t("common.notFound")}</span>
    ),
    right: (
      <HeaderActions
        sections={[{ key: "main", items: [...actions] }]}
        iconOnlyBelow="md"
        overflow
        overflowAlign="end"
      />
    ),
  } satisfies React.ComponentProps<typeof StandardPageHeader>

  // First paint: render a full-page skeleton (match Jobs/Runs/Workflows UX).
  if (loading && !schedule && !err) {
    return <LoadingState textKey="common.loading" spinner placement="top" minHeightClassName="min-h-[40vh]" />
  }

  // Main resource load failure: render a page-level error state (no top alert).
  if (err && !schedule && !loading) {
    return (
      <PageLoadError
        error={err}
        onRetry={() => void refreshSchedule()}
        backHref="/schedules"
        backLabelKey="nav.schedules"
      />
    )
  }

  return (
    <DetailPageLayout modals={modalsNode} header={<StandardPageHeader {...headerProps} />}>
      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard className="flex-none text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("common.overview")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TwoLineMiniCard
                title={t("common.overview")}
                titleRightClassName={cn(scheduleStatusUi.varsClassName, scheduleStatusUi.textClassName)}
                titleRight={
                  scheduleStatusUi.Icon ? (
                    <scheduleStatusUi.Icon
                      className={cn("size-4", scheduleStatusUi.iconClassName)}
                      aria-hidden="true"
                    />
                  ) : null
                }
                value={statusText}
              />
              <TwoLineMiniCard
                title={t("schedules.kind")}
                titleRight={<Calendar className="size-4" aria-hidden="true" />}
                value={scheduleKindLabel(schedule?.kind)}
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <TwoLineMiniCard
                title={t("common.entities.workflow")}
                titleRight={<ExternalLink className="size-4" aria-hidden="true" />}
                value={String(schedule?.workflow?.name ?? "—")}
                valueClassName="font-mono text-sm"
                href={schedule?.workflowId ? `/workflows/${String(schedule.workflowId)}` : undefined}
              />
              <TwoLineMiniCard
                title={t("schedules.detail.nextRunAt")}
                titleRight={<Clock3 className="size-4" aria-hidden="true" />}
                value={formatRelativeTimeFromNow(schedule?.nextRunAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(schedule?.nextRunAt ?? null, {
                  locale,
                  timeZone: effectiveTimezone,
                })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("schedules.detail.lastRunAt")}
                titleRight={<Clock3 className="size-4" aria-hidden="true" />}
                value={formatRelativeTimeFromNow(schedule?.lastRunAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(schedule?.lastRunAt ?? null, {
                  locale,
                  timeZone: effectiveTimezone,
                })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("common.fields.createdAt")}
                titleRight={<Calendar className="size-4" aria-hidden="true" />}
                value={formatRelativeTimeFromNow(schedule?.createdAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(schedule?.createdAt ?? null, {
                  locale,
                  timeZone: effectiveTimezone,
                })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("common.fields.updatedAt")}
                titleRight={<Calendar className="size-4" aria-hidden="true" />}
                value={formatRelativeTimeFromNow(schedule?.updatedAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(schedule?.updatedAt ?? null, {
                  locale,
                  timeZone: effectiveTimezone,
                })}
                valueClassName="font-mono text-sm"
              />
            </div>
          </SectionCardBody>
        </SectionCard>

        <SectionCard className="flex-none text-card-foreground">
          <SectionCardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{t("schedules.detail.scheduleSpec")}</div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => void refreshPreview()}
                disabled={previewLoading}
              >
                {previewLoading ? t("common.loading") : t("common.refreshAction")}
              </Button>
            </div>
          </SectionCardHeader>
          <SectionCardBody className="p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <TwoLineMiniCard
                title={t("schedules.kind")}
                titleRight={<Calendar className="size-4" aria-hidden="true" />}
                value={scheduleKindLabel(schedule?.kind)}
                valueClassName="font-mono text-sm"
              />
              {schedule?.kind === "CRON" ? (
                <TwoLineMiniCard
                  title={t("schedules.timezone")}
                  titleRight={<Calendar className="size-4" aria-hidden="true" />}
                  value={String(schedule?.timezone ?? "UTC")}
                  valueClassName="font-mono text-sm"
                />
              ) : (
                <TwoLineMiniCard
                  title={t("schedules.intervalMs")}
                  titleRight={<Calendar className="size-4" aria-hidden="true" />}
                  value={typeof schedule?.intervalMs === "number" ? `${schedule.intervalMs}ms` : "—"}
                  valueClassName="font-mono text-sm"
                />
              )}

              {schedule?.kind === "CRON" ? (
                <TwoLineMiniCard
                  title={t("schedules.cron")}
                  titleRight={<Calendar className="size-4" aria-hidden="true" />}
                  value={String(schedule?.cron ?? "—")}
                  valueClassName="font-mono text-sm"
                  valueTitle={String(schedule?.cron ?? "")}
                />
              ) : null}
            </div>

            <div className="mt-3 rounded-md border bg-muted/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-muted-foreground">{t("schedules.detail.nextRuns")}</div>
              </div>
              {previewErr ? (
                <div className="mt-2 text-xs text-muted-foreground">{t("common.loadFailed")}</div>
              ) : (previewTimes ?? []).length ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {previewTimes.map((iso) => (
                    <li key={iso} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{formatRelativeTimeFromNow(iso, { locale })}</span>
                      <span
                        className="font-mono"
                        title={formatAbsoluteTime(iso, {
                          locale,
                          timeZone: String(schedule?.timezone ?? "UTC") || "UTC",
                        })}
                      >
                        {formatAbsoluteTime(iso, { locale, timeZone: effectiveTimezone })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-xs text-muted-foreground">—</div>
              )}
            </div>
          </SectionCardBody>
        </SectionCard>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <SectionCard className="flex-none text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("common.executionPolicies")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <TwoLineMiniCard
                title={t("schedules.detail.misfirePolicy")}
                value={misfirePolicyLabel(schedule?.misfirePolicy)}
                valueClassName="text-sm"
              />
              <TwoLineMiniCard
                title={t("schedules.detail.catchUpLimit")}
                value={catchUpLimitLabel(schedule)}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("schedules.detail.overlapPolicy")}
                value={overlapPolicyLabel(schedule?.overlapPolicy)}
                valueClassName="text-sm"
              />
              <TwoLineMiniCard
                title={t("common.pinnedWorkflowVersion")}
                value={pinnedWorkflowVersionLabel(schedule)}
                valueClassName="font-mono text-sm"
              />
            </div>
          </SectionCardBody>
        </SectionCard>

        <SectionCard className="flex-none text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("common.inputParams")}</div>
          </SectionCardHeader>
          <SectionCardBody>
            <JsonViewer value={inputJsonParsed} />
          </SectionCardBody>
        </SectionCard>
      </div>

      {/* Jobs (copied structure from BatchDetailPage; only data source differs) */}
      {jobsErr ? <ErrorAlert titleKey="common.loadFailed" error={jobsErr} /> : null}
      <StandardListPage<JobsListItemModel>
        title={t("schedules.detail.recentJobs")}
        description={undefined}
        search={{
          value: search,
          placeholder: t("jobs.searchPlaceholder"),
          inputRef: searchInputRef,
          onChange: setSearch,
          onReset: () => {
            setSearch("")
            setPageIndex(0)
          },
        }}
        mobileBar={{
          left: (
            <div className="text-sm font-medium text-muted-foreground md:hidden">
              {t("jobs.showingTotal", { total: jobsTotal })}
            </div>
          ),
        }}
        listHeader={{
          left: <div className="hidden md:block">{t("jobs.showingTotal", { total: jobsTotal })}</div>,
          right: (
            <div className="w-full md:w-auto">
              {renderFilters({ className: "justify-start md:justify-end", disabled: jobsLoading || jobsRefreshing })}
            </div>
          ),
        }}
        emptyState={{
          loading: jobsLoading,
          filtersActive,
          empty: t("jobs.emptyState"),
          noResultsTitle: t("jobs.noResultsTitle"),
          noResultsDescription: t("common.list.noResultsDescription"),
          clearFiltersLabel: t("common.filters.clearAction"),
          onClearFilters: clearFilters,
        }}
        list={{
          items: listItems,
          getRowKey: (it) => it.id,
          renderSkeleton: (idx) => <CommonListItemSkeleton key={`skwrap:${idx}`} />,
          renderRow: (it) => (
            <JobsCommonListItem
              key={it.id}
              locale={locale}
              model={it}
              href={`/jobs/${it.id}`}
              formatDurationMs={(ms) => formatDurationMs(ms, { locale })}
              statusLabel={jobStatusLabel}
              showActions={false}
              showScheduledFor={true}
            />
          ),
        }}
        pagination={{
          pageIndex: safePageIndex,
          totalPages,
          onPageIndexChange: setPageIndex,
          compactOnMobile: true,
          previousLabel: t("common.prevPageAction"),
          nextLabel: t("common.nextPageAction"),
        }}
      />
    </DetailPageLayout>
  )
}

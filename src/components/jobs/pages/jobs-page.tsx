"use client"

import { Ban, Plus } from "lucide-react"
import * as React from "react"

import { useJobsPage, type JobRow, type JobsSortKey } from "@/components/jobs/hooks/use-jobs-page"
import { useJobsListFilters } from "@/components/jobs/hooks/use-jobs-list-filters"
import { StandardConfirmDialog } from "@/components/common/standard-confirm-dialog"
import { StandardListPage } from "@/components/common/standard-list-page"
import { useI18n } from "@/components/i18n-provider"
import { NewJobSheet } from "@/components/jobs/sheets/new-job-sheet"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { JobsCommonListItem } from "@/components/jobs/list/jobs-common-list-item"
import { JobsListPageSkeleton } from "@/components/jobs/list/jobs-list-page-skeleton"
import { useLoadErrorAlert } from "@/hooks/use-load-error-alert"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { useTopicStream } from "@/hooks/use-topic-stream"
import { makeListTopicForViewer } from "@/lib/shared/realtime/viewer-topics"
import type { Viewer } from "@/lib/shared/viewer"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export default function JobsPage(props: { viewer: Viewer }) {
  const { t, locale } = useI18n()
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)
  const {
    total,
    search,
    exactStatus,
    sort,
    loading,
    refreshing,
    loadError,
    pageSize,
    createOpen,
    redirectTo,
    exactStatusOptions,
    totalPages,
    safePageIndex,
    pageRows,
    statusLabel,
    jobDurationMs,
    setSearch,
    setExactStatus,
    setSort,
    setPageIndex,
    refresh,
    copyText,
    resumeJob,
    onCreateOpenChange,
    formatDurationMs,
  } = useJobsPage()

  const loadErrorAlert = useLoadErrorAlert(loadError, [
    { key: "refresh", label: t("common.refreshAction"), onClick: () => void refresh() },
  ])
  const skeletonCount = Math.min(pageSize, 10)
  const { listItems } = useStableListRows({ rows: pageRows, loading, skeletonCount })
  const busy = loading || refreshing

  const refreshTmrRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    return () => {
      if (refreshTmrRef.current) window.clearTimeout(refreshTmrRef.current)
    }
  }, [])

  // Strategy B (SSE → debounce refetch):
  // - The Jobs list has more complex fields/derivations and filtering/sorting interactions, and list-topic events
  //   don't carry enough information to patch the final UI row safely.
  // - So SSE is used as a "dirty" signal only: debounce bursts (250ms) and then `refetch()` for correctness.
  useTopicStream({
    topic: makeListTopicForViewer("jobs", props.viewer),
    enabled: true,
    onMessage: (msg) => {
      if (msg.type !== "job_state") return
      if (refreshTmrRef.current) window.clearTimeout(refreshTmrRef.current)
      refreshTmrRef.current = window.setTimeout(() => void refresh(), 250)
    },
  })

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
    statusLabel,
  })

  const headerActions = [
    {
      key: "new",
      label: t("jobs.newJob"),
      icon: <Plus aria-hidden="true" />,
      onClick: () => onCreateOpenChange(true),
      pinned: true,
    },
  ] as const

  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelPending, setCancelPending] = React.useState(false)
  const [cancelJobId, setCancelJobId] = React.useState<string | null>(null)
  const [cancelReason, setCancelReason] = React.useState("")

  function openCancelDialog(jobId: string) {
    setCancelJobId(jobId)
    setCancelReason("")
    setCancelOpen(true)
  }

  async function confirmCancel() {
    if (!cancelJobId || cancelPending) return
    setCancelPending(true)
    try {
      const reason = cancelReason.trim()
      await apiFetchJson(`/api/jobs/${encodeURIComponent(cancelJobId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      })
      toast.success(t("jobs.cancelRequestedToast"))
      setCancelOpen(false)
      setCancelJobId(null)
      setCancelReason("")
      await refresh()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "runs.cancelFailed" }))
    } finally {
      setCancelPending(false)
    }
  }

  // ---- Hooks must stay above any conditional returns (Rules of Hooks). ----
  if (loading && pageRows.length === 0) {
    return <JobsListPageSkeleton rows={skeletonCount} />
  }

  return (
    <StandardListPage<JobRow>
      alert={loadErrorAlert}
      modals={
        <>
          <NewJobSheet open={createOpen} onOpenChange={onCreateOpenChange} redirectTo={redirectTo} />
          <StandardConfirmDialog
            open={cancelOpen}
            onOpenChange={(o) => !cancelPending && setCancelOpen(o)}
            title={t("runs.cancelRunTitle")}
            description={
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">{t("runs.cancelRunDescription")}</div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="jobs-list-cancel-reason">{t("runs.cancelReasonLabel")}</FieldLabel>
                  <Input
                    id="jobs-list-cancel-reason"
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
            onConfirm={() => void confirmCancel()}
            pending={cancelPending}
          />
        </>
      }
      title={t("nav.jobs")}
      description={t("jobs.recentJobsDescription")}
      actions={{
        sections: [{ key: "main", items: [...headerActions] }],
        iconOnlyBelow: "md",
        overflow: true,
        overflowAlign: "end",
      }}
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
          <div className="text-sm font-medium text-muted-foreground lg:hidden">{t("jobs.showingTotal", { total })}</div>
        ),
      }}
      listHeader={{
        left: <div className="hidden lg:block">{t("jobs.showingTotal", { total })}</div>,
        right: (
          <div className="w-full lg:w-auto">
            {renderFilters({ className: "justify-start lg:justify-end", disabled: busy })}
          </div>
        ),
      }}
      emptyState={{
        loading,
        filtersActive,
        empty: t("jobs.emptyState"),
        noResultsTitle: t("jobs.noResultsTitle"),
        noResultsDescription: t("common.list.noResultsDescription"),
        clearFiltersLabel: t("common.filters.clearAction"),
        onClearFilters: clearFilters,
      }}
      list={{
        items: listItems,
        getRowKey: (it) => it.publicId,
        renderSkeleton: (idx) => <CommonListItemSkeleton key={`skwrap:${idx}`} />,
        renderRow: (it) => (
          <JobsCommonListItem
            key={it.publicId}
            locale={locale}
            model={{
              id: it.publicId,
              title: it.workflowName,
              status: it.status,
              cancelRequestedAt: it.cancelRequestedAt ?? null,
              runCancelRequestedAt: it.runCancelRequestedAt ?? null,
              runStatus: it.runStatus ?? null,
              workflowId: it.workflowId,
              queuedAt: it.queuedAt,
              scheduledFor: it.scheduledFor ?? null,
              startedAt: it.startedAt,
              finishedAt: it.finishedAt,
              nextAttemptAt: it.nextAttemptAt ?? null,
              claimedBy: it.claimedBy ?? null,
              claimedAt: it.claimedAt ?? null,
              leaseExpiresAt: it.leaseExpiresAt ?? null,
              runId: it.runId,
              attemptCount: it.attemptCount,
              maxAttempts: it.maxAttempts,
              lastErrorCode: it.lastErrorCode ?? null,
              lastErrorMessage: it.lastErrorMessage ?? null,
              lastErrorMetaJson: it.lastErrorMetaJson ?? null,
              lastErrorAt: it.lastErrorAt ?? null,
              scheduleId: it.scheduleId ?? null,
              scheduleName: it.scheduleName ?? null,
              batchId: it.batchId ?? null,
              batchName: it.batchName ?? null,
            }}
            href={`/jobs/${it.publicId}`}
            formatDurationMs={formatDurationMs}
            statusLabel={statusLabel}
            showScheduledFor={true}
            actions={{
              copyId: () => copyText(it.publicId),
              resume: () => void resumeJob(it.publicId),
              cancel: () => openCancelDialog(it.publicId),
              copyLink: () => void copyText(`${window.location.origin}/jobs/${it.publicId}`),
            }}
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
  )
}

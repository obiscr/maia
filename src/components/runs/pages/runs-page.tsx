"use client"

import { ArrowDownNarrowWide, ArrowUpNarrowWide, Ban } from "lucide-react"
import * as React from "react"

import { useRunsPage, type RunRow, type RunsSortKey } from "@/components/runs/hooks/use-runs-page"
import { StandardConfirmDialog } from "@/components/common/standard-confirm-dialog"
import { StandardListPage } from "@/components/common/standard-list-page"
import type { ListFilterOption } from "@/components/common/list-sort-status-filters"
import { ListSortStatusFilters } from "@/components/common/list-sort-status-filters"
import { useI18n } from "@/components/i18n-provider"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { RunsCommonListItem } from "@/components/runs/list/runs-common-list-item"
import { RunsListPageSkeleton } from "@/components/runs/list/runs-list-page-skeleton"
import { useLoadErrorAlert } from "@/hooks/use-load-error-alert"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { runStatusUiSpec, toCanonicalRunStatus } from "@/lib/shared/run-status"
import { useRunsListSsePatch } from "@/components/runs/pages/use-runs-list-sse-patch"
import { makeListTopicForViewer } from "@/lib/shared/realtime/viewer-topics"
import type { Viewer } from "@/lib/shared/viewer"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export default function RunsPage(props: { viewer: Viewer }) {
  const { t, locale } = useI18n()
  const [filtersOpen, setFiltersOpen] = React.useState("")
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
    exactStatusOptions,
    totalPages,
    safePageIndex,
    pageRows,
    statusLabel,
    formatDurationMs,
    setSearch,
    setExactStatus,
    setSort,
    setPageIndex,
    refresh,
    copyText,
  } = useRunsPage()

  const loadErrorAlert = useLoadErrorAlert(loadError, [
    { key: "refresh", label: t("common.refreshAction"), onClick: () => void refresh() },
  ])
  const skeletonCount = Math.min(pageSize, 10)
  const { listItems } = useStableListRows({ rows: pageRows, loading, skeletonCount })

  const listTopic = makeListTopicForViewer("runs", props.viewer)
  useRunsListSsePatch({ topic: listTopic, enabled: true })

  const filtersActive = !!search.trim() || exactStatus !== "ANY" || sort !== "CREATED_DESC"

  function clearFilters() {
    setFiltersOpen("")
    setSearch("")
    setExactStatus("ANY")
    setSort("CREATED_DESC")
    setPageIndex(0)
  }

  const statusOpts: Array<ListFilterOption & { value: string }> = exactStatusOptions.map((s) => ({
    value: s,
    label: s === "ANY" ? t("common.any") : statusLabel(s),
    icon:
      s === "ANY"
        ? null
        : (() => {
            const canon = toCanonicalRunStatus(s)
            const spec = runStatusUiSpec(canon)
            return spec.Icon ? (
              <spec.Icon
                className={["size-4", spec.iconClassName, spec.varsClassName, spec.textClassName]
                  .filter(Boolean)
                  .join(" ")}
                aria-hidden="true"
              />
            ) : null
          })(),
  }))
  const sortOpts: ReadonlyArray<ListFilterOption & { value: RunsSortKey }> = [
    {
      value: "CREATED_DESC",
      label: t("common.sortNewest"),
      icon: <ArrowDownNarrowWide className="text-muted-foreground" aria-hidden="true" />,
    },
    {
      value: "CREATED_ASC",
      label: t("common.sortOldest"),
      icon: <ArrowUpNarrowWide className="text-muted-foreground" aria-hidden="true" />,
    },
  ] as const

  const busy = loading || refreshing
  const filters = (opts: { className?: string; disabled?: boolean }) => (
    <ListSortStatusFilters
      value={filtersOpen}
      onValueChange={setFiltersOpen}
      disabled={opts.disabled}
      className={opts.className}
      sort={sort}
      sortLabel={t("common.sort")}
      sortOptions={sortOpts}
      onSelectSort={setSort}
      status={exactStatus}
      statusLabel={t("common.status")}
      statusOptions={statusOpts}
      onSelectStatus={setExactStatus}
    />
  )

  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelPending, setCancelPending] = React.useState(false)
  const [cancelRunId, setCancelRunId] = React.useState<string | null>(null)
  const [cancelReason, setCancelReason] = React.useState("")

  const [forceStopOpen, setForceStopOpen] = React.useState(false)
  const [forceStopPending, setForceStopPending] = React.useState(false)
  const [forceStopRunId, setForceStopRunId] = React.useState<string | null>(null)

  function openCancelDialog(runId: string) {
    setCancelRunId(runId)
    setCancelReason("")
    setCancelOpen(true)
  }

  async function confirmCancel() {
    if (!cancelRunId || cancelPending) return
    setCancelPending(true)
    try {
      const reason = cancelReason.trim()
      await apiFetchJson(`/api/runs/${encodeURIComponent(cancelRunId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      })
      toast.success(t("runs.canceledToast"))
      setCancelOpen(false)
      setCancelRunId(null)
      setCancelReason("")
      await refresh()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "runs.cancelFailed" }))
    } finally {
      setCancelPending(false)
    }
  }

  function openForceStopDialog(runId: string) {
    setForceStopRunId(runId)
    setForceStopOpen(true)
  }

  async function confirmForceStop() {
    if (!forceStopRunId || forceStopPending) return
    setForceStopPending(true)
    try {
      await apiFetchJson(`/api/runs/${encodeURIComponent(forceStopRunId)}/force-stop`, { method: "POST" })
      toast.success(t("runs.forceStopToast"))
      setForceStopOpen(false)
      setForceStopRunId(null)
      await refresh()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "runs.forceStopFailed" }))
    } finally {
      setForceStopPending(false)
    }
  }

  // ---- Hooks must stay above any conditional returns (Rules of Hooks). ----
  if (loading && pageRows.length === 0) {
    return <RunsListPageSkeleton rows={skeletonCount} />
  }

  return (
    <StandardListPage<RunRow>
      alert={loadErrorAlert}
      modals={
        <>
          <StandardConfirmDialog
            open={cancelOpen}
            onOpenChange={(o) => !cancelPending && setCancelOpen(o)}
            title={t("runs.cancelRunTitle")}
            description={
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">{t("runs.cancelRunDescription")}</div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="runs-list-cancel-reason">{t("runs.cancelReasonLabel")}</FieldLabel>
                  <Input
                    id="runs-list-cancel-reason"
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
          <StandardConfirmDialog
            open={forceStopOpen}
            onOpenChange={(o) => !forceStopPending && setForceStopOpen(o)}
            title={t("runs.forceStopTitle")}
            description={t("runs.forceStopDescription")}
            confirmText={t("runs.forceStopAction")}
            confirmVariant="destructive"
            confirmIcon={<Ban className="h-4 w-4" aria-hidden="true" />}
            onConfirm={() => void confirmForceStop()}
            pending={forceStopPending}
          />
        </>
      }
      title={t("nav.runs")}
      description={t("runs.recentRunsDescription")}
      search={{
        value: search,
        placeholder: t("runs.searchPlaceholder"),
        inputRef: searchInputRef,
        onChange: setSearch,
        onReset: () => {
          setSearch("")
          setPageIndex(0)
        },
      }}
      mobileBar={{
        left: (
          <div className="text-sm font-medium text-muted-foreground lg:hidden">{t("runs.showingTotal", { total })}</div>
        ),
      }}
      listHeader={{
        left: <div className="hidden lg:block">{t("runs.showingTotal", { total })}</div>,
        right: (
          <div className="w-full lg:w-auto">
            {filters({ className: "justify-start lg:justify-end", disabled: busy })}
          </div>
        ),
      }}
      emptyState={{
        loading,
        filtersActive,
        empty: t("runs.emptyState"),
        noResultsTitle: t("runs.noResultsTitle"),
        noResultsDescription: t("common.list.noResultsDescription"),
        clearFiltersLabel: t("common.filters.clearAction"),
        onClearFilters: clearFilters,
      }}
      list={{
        items: listItems,
        getRowKey: (it) => it.publicId,
        renderSkeleton: (idx) => <CommonListItemSkeleton key={`skwrap:${idx}`} />,
        renderRow: (it) => (
          <RunsCommonListItem
            key={it.publicId}
            locale={locale}
            model={{
              id: it.publicId,
              title: it.workflowName,
              status: it.status,
              cancelRequestedAt: it.cancelRequestedAt ?? null,
              failureCode: it.failureCode ?? null,
              failureMessage: it.failureMessage ?? null,
              failureMetaJson: it.failureMetaJson ?? null,
              failureAt: it.failureAt ?? null,
              createdAt: it.createdAt,
              startedAt: it.startedAt,
              finishedAt: it.finishedAt,
              pill: it.workflowVersionNumber ? `v${it.workflowVersionNumber}` : null,
              subtitle: null,
              workflowId: it.workflowId,
              stepsTotal: typeof it.stepsTotal === "number" ? it.stepsTotal : null,
              stepsDone: typeof it.stepsDone === "number" ? it.stepsDone : null,
              runningStepName: it.runningStepName ?? null,
              failedStepName: it.failedStepName ?? null,
              inputParamsCount: typeof it.inputParamsCount === "number" ? it.inputParamsCount : null,
              inputFilesCount: typeof it.inputFilesCount === "number" ? it.inputFilesCount : null,
              artifactsCount: typeof it.artifactsCount === "number" ? it.artifactsCount : null,
              attemptsCount: typeof it.attemptsCount === "number" ? it.attemptsCount : null,
            }}
            href={`/runs/${it.publicId}`}
            formatDurationMs={formatDurationMs}
            statusLabel={statusLabel}
            actions={{
              cancel: () => openCancelDialog(it.publicId),
              forceStop: () => openForceStopDialog(it.publicId),
              copyId: () => void copyText(it.publicId),
              copyLink: () => void copyText(`${window.location.origin}/runs/${it.publicId}`),
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

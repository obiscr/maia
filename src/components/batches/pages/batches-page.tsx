"use client"

import { Plus } from "lucide-react"
import * as React from "react"
import { ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react"

import { useBatchesPage, type BatchRow, type BatchesSortKey } from "@/components/batches/hooks/use-batches-page"
import { StandardListPage } from "@/components/common/standard-list-page"
import { ListSortStatusFilters } from "@/components/common/list-sort-status-filters"
import type { ListFilterOption } from "@/components/common/list-sort-status-filters"
import { useI18n } from "@/components/i18n-provider"
import { NewBatchSheet } from "@/components/batches/sheets/new-batch-sheet"
import { BatchesCommonListItem } from "@/components/batches/list/batches-common-list-item"
import { BatchesListPageSkeleton } from "@/components/batches/list/batches-list-page-skeleton"
import { HeaderActions } from "@/components/common/header-actions"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { useLoadErrorAlert } from "@/hooks/use-load-error-alert"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { useTopicStream } from "@/hooks/use-topic-stream"
import { useViewer } from "@/hooks/use-viewer"
import { makeListTopicForViewer } from "@/lib/shared/realtime/viewer-topics"
import { batchStatusUiSpec, toCanonicalBatchStatus } from "@/lib/shared/batch-status"

export default function BatchesPage() {
  const { t, locale } = useI18n()
  const viewer = useViewer()
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
    createOpen,
    exactStatusOptions,
    totalPages,
    safePageIndex,
    pageRows,
    statusLabel,
    batchDurationMs,
    setSearch,
    setExactStatus,
    setSort,
    setPageIndex,
    refresh,
    copyText,
    pauseBatch,
    resumeBatch,
    cancelBatch,
    onCreateOpenChange,
    formatDurationMs,
  } = useBatchesPage()

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

  useTopicStream({
    topic: viewer ? makeListTopicForViewer("batches", viewer) : null,
    enabled: true,
    onMessage: (msg) => {
      if (msg.type !== "batch_state" && msg.type !== "job_state") return
      // Strategy B (SSE → debounce refetch):
      // - The Batches list depends on many fields (and is sensitive to filtering/sorting), so list-topic events
      //   aren't sufficient to patch safely.
      // - Treat SSE as a "dirty" signal and debounce (250ms) before `refetch()` to avoid request thrashing.
      if (refreshTmrRef.current) window.clearTimeout(refreshTmrRef.current)
      refreshTmrRef.current = window.setTimeout(() => void refresh(), 250)
    },
  })

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
            const canon = toCanonicalBatchStatus(s)
            const ui = batchStatusUiSpec(canon)
            return ui.Icon ? (
              <ui.Icon
                className={[ui.iconClassName, ui.varsClassName, ui.textClassName, "size-4"].filter(Boolean).join(" ")}
                aria-hidden="true"
              />
            ) : null
          })(),
  }))
  const sortOpts: ReadonlyArray<ListFilterOption & { value: BatchesSortKey }> = [
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

  const headerActions = [
    {
      key: "new",
      label: t("batches.newBatch"),
      icon: <Plus aria-hidden="true" />,
      onClick: () => onCreateOpenChange(true),
      pinned: true,
    },
  ] as const

  // ---- Hooks must stay above any conditional returns (Rules of Hooks). ----
  if (loading && pageRows.length === 0) {
    return <BatchesListPageSkeleton rows={skeletonCount} />
  }

  return (
    <StandardListPage<BatchRow>
      alert={loadErrorAlert}
      modals={
        <>
          <NewBatchSheet open={createOpen} onOpenChange={onCreateOpenChange} />
        </>
      }
      title={t("nav.batches")}
      description={t("batches.recentBatchesDescription")}
      search={{
        value: search,
        placeholder: t("batches.searchPlaceholder"),
        inputRef: searchInputRef,
        onChange: setSearch,
        onReset: () => {
          setSearch("")
          setPageIndex(0)
        },
        desktopRight: <HeaderActions sections={[{ key: "main", items: [...headerActions] }]} iconOnlyBelow="md" />,
      }}
      mobileBar={{
        left: (
          <div className="text-sm font-medium text-muted-foreground lg:hidden">
            {t("batches.showingTotal", { total })}
          </div>
        ),
        right: <HeaderActions sections={[{ key: "main", items: [...headerActions] }]} iconOnlyBelow="md" />,
      }}
      listHeader={{
        left: (
          <div className="hidden lg:block text-sm font-medium text-muted-foreground">
            {t("batches.showingTotal", { total })}
          </div>
        ),
        right: (
          <div className="w-full lg:w-auto">
            {filters({ className: "justify-start lg:justify-end", disabled: busy })}
          </div>
        ),
      }}
      emptyState={{
        loading,
        filtersActive,
        empty: t("batches.emptyState"),
        noResultsTitle: t("batches.noResultsTitle"),
        noResultsDescription: t("common.list.noResultsDescription"),
        clearFiltersLabel: t("common.filters.clearAction"),
        onClearFilters: clearFilters,
      }}
      list={{
        items: listItems,
        getRowKey: (it) => it.publicId,
        renderSkeleton: (idx) => <CommonListItemSkeleton key={`skwrap:${idx}`} />,
        renderRow: (it) => (
          <BatchesCommonListItem
            key={it.publicId}
            locale={locale}
            model={{
              id: it.publicId,
              title: it.name?.trim() ? String(it.name) : it.workflowName,
              status: it.status,
              createdAt: it.createdAt,
              startedAt: it.startedAt,
              finishedAt: it.finishedAt,
              jobsTotal: it.jobsTotal,
              jobsByStatus: it.jobsByStatus ?? null,
              workflowId: it.workflowId ?? null,
              workflowName: it.workflowName ?? "—",
              pinnedWorkflowVersionNumber: it.pinnedWorkflowVersionNumber ?? null,
              concurrencyLimit: it.concurrencyLimit ?? null,
              rampUpSeconds: it.rampUpSeconds ?? null,
              autoMaxConcurrency: it.autoMaxConcurrency ?? null,
              failFast: it.failFast ?? null,
              maxFailures: it.maxFailures ?? null,
              urlFilesCount: it.urlFilesCount ?? null,
              provenance: it.provenance ?? null,
            }}
            href={`/batches/${it.publicId}`}
            formatDurationMs={formatDurationMs}
            statusLabel={statusLabel}
            actions={{
              copyId: () => copyText(it.publicId),
              pause: () => void pauseBatch(it.publicId),
              resume: () => void resumeBatch(it.publicId),
              cancel: () => void cancelBatch(it.publicId),
              copyLink: () => void copyText(`${window.location.origin}/batches/${it.publicId}`),
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

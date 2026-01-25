"use client"

import { ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react"
import * as React from "react"

import { StandardListPage } from "@/components/common/standard-list-page"
import { ListSortStatusFilters, type ListFilterOption } from "@/components/common/list-sort-status-filters"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { useLoadErrorAlert } from "@/hooks/use-load-error-alert"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { OperationsCommonListItem } from "@/components/operations/list/operations-common-list-item"
import { OperationsListPageSkeleton } from "@/components/operations/list/operations-list-page-skeleton"
import {
  useOperationsPage,
  type OperationRow,
  type OperationsSortKey,
} from "@/components/operations/hooks/use-operations-page"
import type { Viewer } from "@/lib/shared/viewer"

export default function OperationsPage(props: { viewer: Viewer }) {
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
    pendingCount,
    canLoadPending,
    loadPendingNew,
    goToNewestView,
    setSearch,
    setExactStatus,
    setSort,
    setPageIndex,
    refresh,
    copyText,
  } = useOperationsPage({ viewer: props.viewer })

  const loadErrorAlert = useLoadErrorAlert(loadError, [
    { key: "refresh", label: t("common.refreshAction"), onClick: () => void refresh() },
  ])
  const skeletonCount = Math.min(pageSize, 10)
  const { listItems } = useStableListRows({ rows: pageRows, loading, skeletonCount })

  const filtersActive = !!search.trim() || exactStatus !== "ANY" || sort !== "CREATED_DESC"
  const busy = loading || refreshing

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
    icon: null,
  }))
  const sortOpts: ReadonlyArray<ListFilterOption & { value: OperationsSortKey }> = [
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

  // ---- Hooks must stay above any conditional returns (Rules of Hooks). ----
  if (loading && pageRows.length === 0) {
    return <OperationsListPageSkeleton rows={skeletonCount} />
  }

  return (
    <StandardListPage<OperationRow>
      alert={loadErrorAlert}
      title={t("operations.title")}
      description={t("operations.recentOperationsDescription")}
      search={{
        value: search,
        placeholder: t("operations.searchPlaceholder"),
        inputRef: searchInputRef,
        onChange: setSearch,
        onReset: () => {
          setSearch("")
          setPageIndex(0)
        },
      }}
      mobileBar={{
        left: (
          <div className="text-sm font-medium text-muted-foreground lg:hidden">
            {t("operations.showingTotal", { total })}
          </div>
        ),
      }}
      listHeader={{
        left: (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="hidden lg:block">{t("operations.showingTotal", { total })}</div>
            {pendingCount > 0 ? (
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 truncate text-sm text-muted-foreground">
                  {t("operations.pendingNewNotice", { count: pendingCount })}
                </div>
                {canLoadPending ? (
                  <Button size="sm" variant="secondary" onClick={() => loadPendingNew()}>
                    {t("operations.pendingNewLoadAction")}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={goToNewestView}>
                    {t("operations.pendingNewGoToNewestAction")}
                  </Button>
                )}
              </div>
            ) : null}
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
        empty: t("operations.emptyState"),
        noResultsTitle: t("operations.noResultsTitle"),
        noResultsDescription: t("common.list.noResultsDescription"),
        clearFiltersLabel: t("common.filters.clearAction"),
        onClearFilters: clearFilters,
      }}
      list={{
        items: listItems,
        getRowKey: (it) => it.publicId,
        renderSkeleton: (idx) => <CommonListItemSkeleton key={`skwrap:${idx}`} />,
        renderRow: (it) => (
          <OperationsCommonListItem
            key={it.publicId}
            locale={locale}
            model={{
              id: it.publicId,
              status: it.status,
              action: it.action,
              targetType: it.targetType,
              targetId: it.targetId,
              scope: it.scope,
              audit: it.audit,
              responseStatus: it.responseStatus,
              errorCode: it.errorCode,
              errorMessage: it.errorMessage,
              createdAt: it.createdAt,
              completedAt: it.completedAt,
              progress: it.progress ?? null,
            }}
            href={`/operations/${it.publicId}`}
            statusLabel={statusLabel}
            actions={{ copyId: () => copyText(it.publicId) }}
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

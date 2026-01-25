"use client"

import * as React from "react"
import { ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { StandardListPage } from "@/components/common/standard-list-page"
import { HeaderActions } from "@/components/common/header-actions"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { WorkflowVersionsCommonListItem } from "@/components/workflows/versions/workflow-versions-common-list-item"
import { WorkflowVersionsListPageSkeleton } from "@/components/workflows/versions/workflow-versions-list-page-skeleton"
import { CreateVersionFromSnapshotAction } from "@/components/common/create-version-from-snapshot-action"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { NavMenuFilter, NavMenuFilters } from "@/components/common/nav-menu-filters"
import { PageLoadError } from "@/components/common/page-load-error"
import { useLoadErrorAlert } from "@/hooks/use-load-error-alert"
import {
  useWorkflowVersionsPage,
  type WorkflowVersionsRow,
  type WorkflowVersionsSortKey,
} from "@/components/workflows/versions/hooks/use-workflow-versions-page"

export default function WorkflowVersionsClient(props: { workflowId: string }) {
  const { t, locale } = useI18n()
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)

  const [filtersOpen, setFiltersOpen] = React.useState("")
  const {
    workflowName,
    rows,
    total,
    loading,
    refreshing,
    loadError,
    search,
    setSearch,
    sort,
    setSort,
    pageSize,
    totalPages,
    safePageIndex,
    setPageIndex,
    refresh,
  } = useWorkflowVersionsPage({ workflowId: props.workflowId })

  const loadErrorAlert = useLoadErrorAlert(loadError, [
    { key: "refresh", label: t("common.refreshAction"), onClick: () => void refresh() },
  ])
  const skeletonCount = Math.min(pageSize, 10)
  const { listItems } = useStableListRows({ rows, loading, skeletonCount })

  // ---- Hooks must stay above any conditional returns (Rules of Hooks). ----
  if (loading && rows.length === 0) {
    return <WorkflowVersionsListPageSkeleton rows={skeletonCount} />
  }
  if (loadError && rows.length === 0) {
    return (
      <PageLoadError
        error={loadError}
        onRetry={() => void refresh()}
        backHref={`/workflows/${props.workflowId}`}
        backLabelKey="workflows.versions.backToWorkflow"
      />
    )
  }

  const filtersActive = !!search.trim() || sort !== "CREATED_DESC"
  const busy = loading || refreshing

  function clearFilters() {
    setFiltersOpen("")
    setSearch("")
    setSort("CREATED_DESC")
    setPageIndex(0)
  }

  return (
    <CreateVersionFromSnapshotAction workflowId={props.workflowId} snapshotVersion={null} navigateMode="push">
      {({ openWith, pending }) => (
        <StandardListPage<WorkflowVersionsRow>
          alert={loadErrorAlert}
          title={t("workflows.versions.title")}
          description={
            workflowName
              ? t("workflows.versions.descriptionNamed", { name: workflowName })
              : t("workflows.versions.description")
          }
          search={{
            value: search,
            placeholder: t("workflows.versions.searchPlaceholder"),
            inputRef: searchInputRef,
            onChange: (next) => setSearch(next),
            onReset: () => {
              setSearch("")
              setPageIndex(0)
            },
            desktopRight: (
              <HeaderActions
                sections={[
                  {
                    key: "main",
                    items: [
                      {
                        key: "back",
                        label: t("workflows.versions.backToWorkflow"),
                        href: `/workflows/${props.workflowId}`,
                        pinned: true,
                        variant: "secondary" as const,
                      },
                    ],
                  },
                ]}
                iconOnlyBelow="md"
                overflow={true}
                overflowAlign="end"
              />
            ),
          }}
          mobileBar={{
            left: (
              <div className="text-sm font-medium text-muted-foreground lg:hidden">
                {t("workflows.versions.showingTotal", { total })}
              </div>
            ),
            right: (
              <HeaderActions
                sections={[
                  {
                    key: "main",
                    items: [
                      {
                        key: "back",
                        label: t("workflows.versions.backToWorkflow"),
                        href: `/workflows/${props.workflowId}`,
                        pinned: true,
                        variant: "secondary" as const,
                      },
                    ],
                  },
                ]}
                iconOnlyBelow="md"
                overflow={true}
                overflowAlign="end"
              />
            ),
          }}
          listHeader={{
            left: (
              <div className="hidden lg:block text-sm font-medium text-muted-foreground">
                {t("workflows.versions.showingTotal", { total })}
              </div>
            ),
            right: (
              <div className="w-full lg:w-auto">
                <NavMenuFilters
                  value={filtersOpen}
                  onValueChange={setFiltersOpen}
                  triggerMode="click"
                  contentAlign="end"
                  className="justify-start lg:justify-end"
                  listClassName="justify-start lg:justify-end"
                >
                  <NavMenuFilter
                    menuValue="sort"
                    label={t("common.sort")}
                    showValueInTrigger={false}
                    selectedValue={sort}
                    options={[
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
                    ]}
                    onSelectValue={(v) => setSort(v as WorkflowVersionsSortKey)}
                    closeMenu={() => setFiltersOpen("")}
                    disabled={busy || pending}
                  />
                </NavMenuFilters>
              </div>
            ),
          }}
          emptyState={{
            loading,
            filtersActive,
            empty: t("workflows.versions.empty"),
            noResultsTitle: t("workflows.versions.noResultsTitle"),
            noResultsDescription: t("common.list.noResultsDescription"),
            clearFiltersLabel: t("common.filters.clearAction"),
            onClearFilters: clearFilters,
          }}
          list={{
            items: listItems,
            getRowKey: (row) => row.id,
            renderRow: (row) => (
              <WorkflowVersionsCommonListItem
                locale={locale}
                model={row}
                workflowId={props.workflowId}
                href={`/workflows/${props.workflowId}/versions/${encodeURIComponent(String(row.version))}`}
                onRestore={(ver) => openWith(ver)}
              />
            ),
            renderSkeleton: () => <CommonListItemSkeleton variant="versions" />,
            skeletonKeyPrefix: "wf:ver:sk",
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
      )}
    </CreateVersionFromSnapshotAction>
  )
}

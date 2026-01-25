"use client"

import * as React from "react"
import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Bot,
  CheckCircle2,
  Download,
  Plus,
  TriangleAlertIcon,
} from "lucide-react"

import { HeaderActions } from "@/components/common/header-actions"
import { StandardListPage } from "@/components/common/standard-list-page"
import { NavMenuFilter, NavMenuFilters, type NavMenuFilterOption } from "@/components/common/nav-menu-filters"
import { useI18n } from "@/components/i18n-provider"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import type { WorkflowRow } from "@/components/workflows/common/workflow-row"
import {
  type WorkflowsPageBoolConfiguredFilter,
  type WorkflowsPageDepsStatusFilter,
  type WorkflowsPageSortKey,
  useWorkflowsPage,
} from "@/components/workflows/hooks/use-workflows-page"
import { WorkflowCommonListItem } from "@/components/workflows/list/workflow-common-list-item"
import { WorkflowListPageSkeleton } from "@/components/workflows/list/workflow-list-skeleton"
import { NewWorkflowSheet } from "@/components/workflows/sheets/new-workflow-sheet"
import { WorkflowImportSheet } from "@/components/workflows/sheets/workflow-import-sheet"
import { useLoadErrorAlert } from "@/hooks/use-load-error-alert"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { workflowDepsStatusUiSpec } from "@/lib/shared/workflow-deps-status"
import { cn } from "@/lib/utils"

export default function WorkflowsPage() {
  const { t, locale } = useI18n()
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)

  const {
    rows,
    total,
    loading,
    refreshing,
    loadError,
    q,
    setSearch,
    sort,
    setSort,
    depsStatus,
    setDepsStatus,
    envConfigured,
    setEnvConfigured,
    inputSpecConfigured,
    setInputSpecConfigured,
    outputsSpecConfigured,
    setOutputsSpecConfigured,
    filtersOpen,
    setFiltersOpen,
    pageSize,
    setPageIndex,
    totalPages,
    safePageIndex,
    createOpen,
    setCreateOpen,
    refresh,
    resetAllFilters,
  } = useWorkflowsPage<WorkflowRow>()

  const loadErrorAlert = useLoadErrorAlert(loadError, [
    { key: "refresh", label: t("common.refreshAction"), onClick: () => void refresh() },
  ])

  const skeletonCount = Math.min(pageSize, 10)
  const { listItems } = useStableListRows({
    rows,
    loading,
    skeletonCount,
  })

  const [importOpen, setImportOpen] = React.useState(false)

  const filtersActive =
    !!q.trim() ||
    depsStatus !== "ANY" ||
    envConfigured !== "ANY" ||
    inputSpecConfigured !== "ANY" ||
    outputsSpecConfigured !== "ANY" ||
    sort !== "UPDATED_DESC"

  const busy = loading || refreshing

  const sortOpts: NavMenuFilterOption[] = [
    {
      value: "UPDATED_DESC",
      label: t("common.sortNewest"),
      icon: <ArrowDownNarrowWide className="text-muted-foreground" aria-hidden="true" />,
    },
    {
      value: "UPDATED_ASC",
      label: t("common.sortOldest"),
      icon: <ArrowUpNarrowWide className="text-muted-foreground" aria-hidden="true" />,
    },
  ]

  const depsStatusOpts: NavMenuFilterOption[] = [
    { value: "ANY", label: t("common.any") },
    {
      value: "READY",
      label: t("workflows.deps.status.ready"),
      icon: (() => {
        const ui = workflowDepsStatusUiSpec("READY")
        const Icon = ui.Icon
        return Icon ? (
          <Icon className={cn("size-4", ui.varsClassName, ui.textClassName, ui.iconClassName)} aria-hidden="true" />
        ) : null
      })(),
    },
    {
      value: "INSTALLING",
      label: t("workflows.deps.status.installing"),
      icon: (() => {
        const ui = workflowDepsStatusUiSpec("INSTALLING")
        const Icon = ui.Icon
        return Icon ? (
          <Icon className={cn("size-4", ui.varsClassName, ui.textClassName, ui.iconClassName)} aria-hidden="true" />
        ) : null
      })(),
    },
    {
      value: "IDLE",
      label: t("workflows.deps.status.install"),
      icon: (() => {
        const ui = workflowDepsStatusUiSpec("IDLE")
        const Icon = ui.Icon
        return Icon ? (
          <Icon className={cn("size-4", ui.varsClassName, ui.textClassName, ui.iconClassName)} aria-hidden="true" />
        ) : null
      })(),
    },
    {
      value: "FAILED",
      label: t("common.statusValues.failed"),
      icon: (() => {
        const ui = workflowDepsStatusUiSpec("FAILED")
        const Icon = ui.Icon
        return Icon ? (
          <Icon className={cn("size-4", ui.varsClassName, ui.textClassName, ui.iconClassName)} aria-hidden="true" />
        ) : null
      })(),
    },
  ]

  const configuredOpts: NavMenuFilterOption[] = [
    { value: "ANY", label: t("common.any") },
    {
      value: "CONFIGURED",
      label: t("common.configured"),
      icon: <CheckCircle2 className="text-emerald-600" aria-hidden="true" />,
    },
    {
      value: "NOT_CONFIGURED",
      label: t("common.notConfigured"),
      icon: <TriangleAlertIcon className="text-muted-foreground" aria-hidden="true" />,
    },
  ]

  const listFilters = (opts: { className?: string; disabled?: boolean }) => (
    <NavMenuFilters
      value={filtersOpen}
      onValueChange={setFiltersOpen}
      triggerMode="click"
      contentAlign="start"
      className={opts.className}
      listClassName={opts.className}
    >
      <NavMenuFilter
        menuValue="sort"
        label={t("common.sort")}
        showValueInTrigger={false}
        selectedValue={sort}
        options={sortOpts}
        onSelectValue={(v) => setSort(v as WorkflowsPageSortKey)}
        closeMenu={() => setFiltersOpen("")}
        disabled={opts.disabled}
      />
      <NavMenuFilter
        menuValue="deps"
        label={t("workflows.filtersShort.deps")}
        showValueInTrigger={false}
        selectedValue={depsStatus}
        options={depsStatusOpts}
        onSelectValue={(v) => setDepsStatus(v as WorkflowsPageDepsStatusFilter)}
        closeMenu={() => setFiltersOpen("")}
        disabled={opts.disabled}
      />
      <NavMenuFilter
        menuValue="env"
        label={t("workflows.filtersShort.env")}
        showValueInTrigger={false}
        selectedValue={envConfigured}
        options={configuredOpts}
        onSelectValue={(v) => setEnvConfigured(v as WorkflowsPageBoolConfiguredFilter)}
        closeMenu={() => setFiltersOpen("")}
        disabled={opts.disabled}
      />
      <NavMenuFilter
        menuValue="inputSpec"
        label={t("common.inputs")}
        showValueInTrigger={false}
        selectedValue={inputSpecConfigured}
        options={configuredOpts}
        onSelectValue={(v) => setInputSpecConfigured(v as WorkflowsPageBoolConfiguredFilter)}
        closeMenu={() => setFiltersOpen("")}
        disabled={opts.disabled}
      />
      <NavMenuFilter
        menuValue="outputsSpec"
        label={t("common.outputs")}
        showValueInTrigger={false}
        selectedValue={outputsSpecConfigured}
        options={configuredOpts}
        onSelectValue={(v) => setOutputsSpecConfigured(v as WorkflowsPageBoolConfiguredFilter)}
        closeMenu={() => setFiltersOpen("")}
        disabled={opts.disabled}
      />
    </NavMenuFilters>
  )

  async function copyText(text: string) {
    try {
      await copyTextToClipboard(text)
      toast(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  function clearFilters() {
    resetAllFilters()
  }

  // ---- Hooks must stay above any conditional returns (Rules of Hooks). ----
  if (loading && rows.length === 0) {
    return <WorkflowListPageSkeleton rows={skeletonCount} />
  }

  const headerActions = [
    {
      key: "ai",
      label: t("workflows.aiOrchestrateAction"),
      icon: <Bot aria-hidden="true" />,
      href: "/agent",
      pinned: true,
      agent: true,
    },
    {
      key: "new",
      label: t("workflows.newWorkflow"),
      icon: <Plus aria-hidden="true" />,
      onClick: () => setCreateOpen(true),
      pinned: true,
    },
    {
      key: "import",
      label: t("common.importAction"),
      icon: <Download aria-hidden="true" />,
      onClick: () => setImportOpen(true),
      overflowOnly: true,
    },
  ] as const

  return (
    <StandardListPage<WorkflowRow>
      alert={loadErrorAlert}
      modals={
        <>
          <NewWorkflowSheet open={createOpen} onOpenChange={setCreateOpen} />
          <WorkflowImportSheet open={importOpen} onOpenChange={setImportOpen} />
        </>
      }
      title={t("workflows.title")}
      description={t("workflows.listDescription")}
      search={{
        value: q,
        placeholder: t("workflows.searchPlaceholder"),
        inputRef: searchInputRef,
        onChange: (next) => setSearch(next),
        onReset: () => {
          setSearch("", { immediate: true })
          setPageIndex(0)
        },
        desktopRight: <HeaderActions sections={[{ key: "main", items: [...headerActions] }]} iconOnlyBelow="md" />,
      }}
      mobileBar={{
        left: (
          <div className="text-sm font-medium text-muted-foreground lg:hidden">
            {t("workflows.showingTotal", { total })}
          </div>
        ),
        right: <HeaderActions sections={[{ key: "main", items: [...headerActions] }]} iconOnlyBelow="md" />,
      }}
      listHeader={{
        left: <div className="hidden lg:block">{t("workflows.showingTotal", { total })}</div>,
        right: (
          <div className="w-full lg:w-auto">
            {listFilters({ className: "justify-start lg:justify-end", disabled: busy })}
          </div>
        ),
      }}
      emptyState={{
        loading,
        filtersActive,
        empty: t("workflows.emptyState"),
        noResultsTitle: t("workflows.noResultsTitle"),
        noResultsDescription: t("common.list.noResultsDescription"),
        clearFiltersLabel: t("common.filters.clearAction"),
        onClearFilters: clearFilters,
      }}
      list={{
        items: listItems,
        getRowKey: (it) => it.publicId,
        renderSkeleton: (idx) => <CommonListItemSkeleton key={`skwrap:${idx}`} />,
        renderRow: (it) => (
          <WorkflowCommonListItem
            key={it.publicId}
            locale={locale}
            model={{
              id: it.publicId,
              title: it.name,
              description: it.description,
              depsStatus: it.depsStatus,
              depsErrorCode: it.depsErrorCode ?? null,
              depsErrorMessage: it.depsErrorMessage ?? null,
              depsErrorMetaJson: it.depsErrorMetaJson ?? null,
              depsErrorAt: it.depsErrorAt ?? null,
              npmDepsCount: it.npmDepsCount,
              envCount: typeof it.envCount === "number" ? it.envCount : null,
              hasInputSpec: !!it.hasInputSpec,
              latestVersionNumber: typeof it.latestVersionNumber === "number" ? it.latestVersionNumber : null,
              lastRun: it.lastRun ?? null,
              stepCount: it.stepCount,
              runCount: it.runCount,
              runningRunCount: it.runningRunCount,
              updatedAt: it.updatedAt ?? null,
            }}
            href={`/workflows/${it.publicId}`}
            actions={{
              copyId: () => void copyText(it.publicId),
              copyLink: () => void copyText(`${window.location.origin}/workflows/${it.publicId}`),
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

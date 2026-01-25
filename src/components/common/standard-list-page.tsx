"use client"

import * as React from "react"

import { ItemsList, type ItemsListProps } from "@/components/common/items-list"
import { ItemListHeader, ItemListHeaderLeft, ItemListHeaderRight } from "@/components/common/item-list-header"
import { PaginationNav, type PaginationNavProps } from "@/components/common/pagination-nav"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import type { ListRow } from "@/components/common/list-row"
import { useScrollContainer } from "@/components/scroll-container-provider"
import { Button } from "@/components/ui/button"
import { HeaderActions } from "@/components/common/header-actions"
import { ListSearch } from "@/components/common/list-search"
import { HeaderSubbar } from "@/components/common/header-subbar"
import { cn } from "@/lib/utils"

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export type StandardListPageSearch = {
  value: string
  placeholder: string
  onChange: (next: string) => void
  onReset: () => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  mobileRight?: React.ReactNode
  desktopRight?: React.ReactNode
}

export type StandardListPageMobileBar = {
  left?: React.ReactNode
  right?: React.ReactNode
}

export type StandardListPageListHeader = {
  left: React.ReactNode
  right?: React.ReactNode
}

export type StandardListPageEmptyState = {
  loading: boolean
  filtersActive: boolean
  empty: React.ReactNode
  noResultsTitle: React.ReactNode
  noResultsDescription: React.ReactNode
  clearFiltersLabel: React.ReactNode
  onClearFilters: () => void
}

export type StandardListPageList<RowT> = Omit<
  ItemsListProps<ListRow<RowT>>,
  "header" | "empty" | "getKey" | "renderItem"
> & {
  /** Items where `null` represents a skeleton row. */
  items: Array<ListRow<RowT>>
  /** Key for a real row. Skeleton keys are auto-generated. */
  getRowKey: (row: RowT, index: number) => React.Key
  /** Render a real row. */
  renderRow: (row: RowT, index: number) => React.ReactNode
  /** Render a skeleton row (optional). If omitted, skeleton rows render null. */
  renderSkeleton?: (index: number) => React.ReactNode
  skeletonKeyPrefix?: string
}

export type StandardListPageProps<RowT> = {
  /** Optional alert element (e.g. load error banner). */
  alert?: React.ReactNode
  /** Optional dialogs/sheets/etc that should be mounted on the page. */
  modals?: React.ReactNode

  title: React.ReactNode
  description?: React.ReactNode

  /** Optional header actions (preferred over putting actions into search.desktopRight). */
  actions?: React.ComponentProps<typeof HeaderActions>

  /** Search UI. */
  search?: StandardListPageSearch

  /** Mobile-only action row under the title bar (e.g. total on left, Create button on right). */
  mobileBar?: StandardListPageMobileBar

  /** List header content inside the bordered list. */
  listHeader: StandardListPageListHeader

  /** Empty state handling. */
  emptyState: StandardListPageEmptyState

  /** List content. */
  list: StandardListPageList<RowT>

  /** Pagination controls. */
  pagination?: PaginationNavProps | null
}

let warnedStandardListPageFlatProps = false

export function StandardListPage<RowT>(props: StandardListPageProps<RowT>) {
  const scrollContainer = useScrollContainer()

  if (!warnedStandardListPageFlatProps && process.env.NODE_ENV !== "production") {
    const anyProps = props as unknown as Record<string, unknown>
    const flatKeys = [
      "searchValue",
      "searchPlaceholder",
      "onSearchChange",
      "onSearchReset",
      "searchInputRef",
      "searchMobileRight",
      "searchDesktopRight",
      "mobileBarLeft",
      "mobileBarRight",
      "listHeaderLeft",
      "listHeaderRight",
      "emptyStateLoading",
      "emptyStateFiltersActive",
      "emptyStateEmpty",
      "emptyStateNoResultsTitle",
      "emptyStateNoResultsDescription",
      "emptyStateClearFiltersLabel",
      "onEmptyStateClearFilters",
      "items",
      "getRowKey",
      "renderRow",
      "renderSkeleton",
      "skeletonKeyPrefix",
      "listClassName",
      "itemGroupClassName",
      "separator",
    ] as const

    const used = flatKeys.filter((k) => typeof anyProps?.[k] !== "undefined")
    if (used.length > 0) {
      warnedStandardListPageFlatProps = true
      console.warn(
        `StandardListPage: detected deprecated/removed flat props (${used.join(", ")}). ` +
          `Use nested props: search/mobileBar/listHeader/emptyState/list.`,
      )
    }
  }

  const resolvedSearch = props.search
  const resolvedMobileBar = props.mobileBar
  const resolvedListHeader = props.listHeader
  const resolvedEmptyState = props.emptyState
  const resolvedList = props.list

  invariant(resolvedListHeader, "StandardListPage: missing `listHeader`.")
  invariant(resolvedEmptyState, "StandardListPage: missing `emptyState`.")
  invariant(resolvedList, "StandardListPage: missing `list`.")

  const onPageIndexChange = React.useCallback(
    (next: number) => {
      // Scroll policy: switching pages is a dataset change; always jump to top.
      scrollContainer?.scrollToTop()
      props.pagination?.onPageIndexChange(next)
    },
    [props.pagination, scrollContainer],
  )

  const empty = resolvedEmptyState.loading ? null : resolvedEmptyState.filtersActive ? (
    <div className="space-y-3">
      <div className="font-medium text-foreground">{resolvedEmptyState.noResultsTitle}</div>
      <div className="text-muted-foreground">{resolvedEmptyState.noResultsDescription}</div>
      <div>
        <Button variant="secondary" size="sm" onClick={resolvedEmptyState.onClearFilters}>
          {resolvedEmptyState.clearFiltersLabel}
        </Button>
      </div>
    </div>
  ) : (
    resolvedEmptyState.empty
  )

  const actionsNode = props.actions ? (
    <HeaderActions
      sections={props.actions.sections}
      iconOnlyBelow={props.actions.iconOnlyBelow}
      overflow={props.actions.overflow}
      overflowLabel={props.actions.overflowLabel}
      overflowAlign={props.actions.overflowAlign}
      className={props.actions.className}
    />
  ) : null

  const headerRight = resolvedSearch ? (
    <ListSearch
      value={resolvedSearch.value}
      placeholder={resolvedSearch.placeholder}
      onChange={resolvedSearch.onChange}
      onReset={resolvedSearch.onReset}
      inputRef={resolvedSearch.inputRef}
      mobileRight={resolvedSearch.mobileRight}
      desktopRight={
        props.actions ? (
          <div className={cn("flex min-w-0 items-center gap-2", props.actions.className)}>
            {resolvedSearch.desktopRight}
            {actionsNode}
          </div>
        ) : (
          resolvedSearch.desktopRight
        )
      }
    />
  ) : (
    actionsNode
  )

  const headerBottom = resolvedMobileBar ? (
    <HeaderSubbar hideAt="lg" className={cn("flex-row items-center justify-between")}>
      {resolvedMobileBar.left ? <HeaderSubbar.Left>{resolvedMobileBar.left}</HeaderSubbar.Left> : null}
      {resolvedMobileBar.right ? <HeaderSubbar.Right>{resolvedMobileBar.right}</HeaderSubbar.Right> : null}
    </HeaderSubbar>
  ) : null

  return (
    <div className="space-y-4">
      {props.alert}
      {props.modals}

      <StandardPageHeader
        title={props.title}
        description={props.description}
        right={headerRight}
        bottom={headerBottom}
      />

      <ItemsList
        {...resolvedList}
        items={resolvedList.items}
        getKey={(it, idx) =>
          it ? resolvedList.getRowKey(it, idx) : `${resolvedList.skeletonKeyPrefix ?? "sk"}:${idx}`
        }
        renderItem={(it, idx) => (it ? resolvedList.renderRow(it, idx) : (resolvedList.renderSkeleton?.(idx) ?? null))}
        empty={empty}
        header={
          <ItemListHeader>
            <ItemListHeaderLeft>{resolvedListHeader.left}</ItemListHeaderLeft>
            {resolvedListHeader.right ? <ItemListHeaderRight>{resolvedListHeader.right}</ItemListHeaderRight> : null}
          </ItemListHeader>
        }
      />

      {props.pagination ? (
        <PaginationNav
          {...props.pagination}
          onPageIndexChange={onPageIndexChange ?? props.pagination.onPageIndexChange}
        />
      ) : null}
    </div>
  )
}

"use client"

import * as React from "react"
import { ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react"

import { ListSortStatusFilters, type ListFilterOption } from "@/components/common/list-sort-status-filters"
import { jobStatusUiSpec, toCanonicalJobStatus } from "@/lib/shared/job-status"

export type JobsSortKey = "CREATED_DESC" | "CREATED_ASC"

export function useJobsListFilters(opts: {
  t: (k: string, vars?: Record<string, string | number>) => string
  search: string
  setSearch: (next: string) => void
  exactStatus: string
  setExactStatus: (next: string) => void
  exactStatusOptions: string[]
  sort: JobsSortKey
  setSort: (next: JobsSortKey) => void
  setPageIndex: (next: number) => void
  searchInputRef?: React.RefObject<HTMLInputElement | null>
  statusLabel: (status: string) => string
}) {
  const { t } = opts
  const [filtersOpen, setFiltersOpen] = React.useState("")

  const filtersActive = !!opts.search.trim() || opts.exactStatus !== "ANY" || opts.sort !== "CREATED_DESC"

  const statusOptions: Array<ListFilterOption & { value: string }> = React.useMemo(
    () =>
      opts.exactStatusOptions.map((s) => ({
        value: s,
        label: s === "ANY" ? t("common.any") : opts.statusLabel(s),
        icon:
          s === "ANY"
            ? null
            : (() => {
                const canon = toCanonicalJobStatus(s)
                const spec = jobStatusUiSpec(canon)
                return spec.Icon ? (
                  <spec.Icon
                    className={["size-4", spec.iconClassName, spec.varsClassName, spec.textClassName]
                      .filter(Boolean)
                      .join(" ")}
                    aria-hidden="true"
                  />
                ) : null
              })(),
      })),
    [opts.exactStatusOptions, opts.statusLabel, t],
  )

  const sortOptions: ReadonlyArray<ListFilterOption & { value: JobsSortKey }> = React.useMemo(
    () => [
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
    ],
    [t],
  )

  const clearFilters = React.useCallback(() => {
    setFiltersOpen("")
    opts.setSearch("")
    opts.setExactStatus("ANY")
    opts.setSort("CREATED_DESC")
    opts.setPageIndex(0)
    requestAnimationFrame(() => opts.searchInputRef?.current?.focus())
  }, [opts])

  const renderFilters = React.useCallback(
    (ui?: { className?: string; disabled?: boolean }) => (
      <ListSortStatusFilters
        value={filtersOpen}
        onValueChange={setFiltersOpen}
        disabled={ui?.disabled}
        className={ui?.className}
        sort={opts.sort}
        sortLabel={t("common.sort")}
        sortOptions={sortOptions}
        onSelectSort={opts.setSort}
        status={opts.exactStatus}
        statusLabel={t("common.status")}
        statusOptions={statusOptions}
        onSelectStatus={opts.setExactStatus}
      />
    ),
    [filtersOpen, opts.exactStatus, opts.setExactStatus, opts.setSort, opts.sort, sortOptions, statusOptions, t],
  )

  return {
    filtersOpen,
    setFiltersOpen,
    filtersActive,
    clearFilters,
    statusOptions,
    sortOptions,
    renderFilters,
  }
}

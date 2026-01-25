"use client"

import * as React from "react"

import { NavMenuFilter, NavMenuFilters } from "@/components/common/nav-menu-filters"

export type ListFilterOption = {
  value: string
  label: React.ReactNode
  icon?: React.ReactNode
}

export function ListSortStatusFilters<SortV extends string, StatusV extends string>(props: {
  value: string
  onValueChange: (v: string) => void
  disabled?: boolean
  className?: string

  sort: SortV
  sortLabel: React.ReactNode
  sortOptions: ReadonlyArray<ListFilterOption & { value: SortV }>
  onSelectSort: (v: SortV) => void

  status: StatusV
  statusLabel: React.ReactNode
  statusOptions: ReadonlyArray<ListFilterOption & { value: StatusV }>
  onSelectStatus: (v: StatusV) => void
}) {
  return (
    <NavMenuFilters
      value={props.value}
      onValueChange={props.onValueChange}
      triggerMode="click"
      contentAlign="start"
      className={props.className}
      listClassName={props.className}
    >
      <NavMenuFilter
        menuValue="sort"
        label={props.sortLabel}
        showValueInTrigger={false}
        selectedValue={props.sort}
        options={props.sortOptions}
        onSelectValue={(v) => props.onSelectSort(v)}
        closeMenu={() => props.onValueChange("")}
        disabled={props.disabled}
      />
      <NavMenuFilter
        menuValue="status"
        label={props.statusLabel}
        showValueInTrigger={false}
        selectedValue={props.status}
        options={props.statusOptions}
        onSelectValue={(v) => props.onSelectStatus(v)}
        closeMenu={() => props.onValueChange("")}
        disabled={props.disabled}
      />
    </NavMenuFilters>
  )
}

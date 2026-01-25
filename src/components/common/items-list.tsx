"use client"

import * as React from "react"

import { ItemGroup, ItemSeparator } from "@/components/ui/item"
import { cn } from "@/lib/utils"

export type ItemsListProps<T> = {
  items: T[]
  getKey: (item: T, index: number) => React.Key
  renderItem: (item: T, index: number) => React.ReactNode
  header?: React.ReactNode
  empty?: React.ReactNode
  className?: string
  itemGroupClassName?: string
  separator?: boolean
}

/**
 * Generic, reusable list container built on shadcn/ui Item.
 * - Supports optional header and empty state.
 * - Inserts separators between rows for GitHub-style dense lists.
 */
export function ItemsList<T>({
  items,
  getKey,
  renderItem,
  header,
  empty,
  className,
  itemGroupClassName,
  separator = true,
}: ItemsListProps<T>) {
  return (
    <div className={cn("rounded-md border", className)}>
      {header ? header : null}
      <ItemGroup className={cn("divide-y-0", itemGroupClassName)}>
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">{empty ?? "—"}</div>
        ) : (
          items.map((it, idx) => (
            <React.Fragment key={getKey(it, idx)}>
              {renderItem(it, idx)}
              {separator && idx < items.length - 1 ? <ItemSeparator /> : null}
            </React.Fragment>
          ))
        )}
      </ItemGroup>
    </div>
  )
}

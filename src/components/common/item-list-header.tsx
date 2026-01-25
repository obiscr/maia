"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export function ItemListHeaderLeft(props: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex min-w-0 items-center gap-2", props.className)}>{props.children}</div>
}

export function ItemListHeaderRight(props: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex items-center gap-2 md:ml-auto", props.className)}>{props.children}</div>
}

export function PageTitleBar(props: {
  title: React.ReactNode
  description?: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-0", props.className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{props.title}</div>
          {props.description ? (
            <div className="whitespace-normal break-words text-sm text-muted-foreground lg:hidden">
              {props.description}
            </div>
          ) : null}
        </div>
        {props.right ? <div className="w-full min-w-0 lg:w-auto lg:shrink-0">{props.right}</div> : null}
      </div>
      {props.description ? (
        <div className="hidden pt-1 text-sm text-muted-foreground lg:block">{props.description}</div>
      ) : null}
    </div>
  )
}

/**
 * GitHub-style list panel header: left summary/count, right filter group.
 * Intended to be used inside a bordered list container.
 */
export function ItemListHeader(props: {
  className?: string
  children?: React.ReactNode
  /** @deprecated Prefer `children` + `ItemListHeaderLeft/Right` so callers can control composition. */
  left?: React.ReactNode
  /** @deprecated Prefer `children` + `ItemListHeaderLeft/Right` so callers can control composition. */
  right?: React.ReactNode
}) {
  if (!props.children && !props.left && !props.right) return null
  return (
    <div
      className={cn(
        // Use gap-based layout (instead of justify-between) so "right" can be placed at start on mobile when "left" is hidden.
        "flex items-center gap-3 border-b bg-muted/10 px-4 py-3",
        props.className,
      )}
    >
      {props.children ? (
        props.children
      ) : (
        <>
          {props.left ? <ItemListHeaderLeft>{props.left}</ItemListHeaderLeft> : null}
          {props.right ? <ItemListHeaderRight>{props.right}</ItemListHeaderRight> : null}
        </>
      )}
    </div>
  )
}

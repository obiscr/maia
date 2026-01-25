"use client"

import * as React from "react"

import { PageTitleBar } from "@/components/common/item-list-header"
import { CommonListItemSkeleton, type CommonListItemSkeletonProps } from "@/components/common/common-list-item-skeleton"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type StandardListPageSkeletonProps = {
  className?: string
  rows?: number

  /** Skeleton width for the page title (e.g. "w-20"). */
  titleWidthClassName?: string

  /**
   * Desktop-only actions rendered next to the search input.
   * Keep this as a slot so callers can match their page's actions count/shape without adding lots of props.
   */
  desktopActions?: React.ReactNode
  /** Convenience: render a single default action button skeleton. Ignored if `desktopActions` is provided. */
  withDesktopActions?: boolean

  /** Whether to render the mobile bar row under the title. */
  withMobileBar?: boolean
  /** Optional right-side controls in the mobile bar (e.g. "Create" button skeletons). */
  mobileBarRight?: React.ReactNode
  /** Optional left-side content in the mobile bar. Defaults to a total/count skeleton. */
  mobileBarLeft?: React.ReactNode

  /** Whether to render the list header's right side controls skeleton. */
  withListHeaderRight?: boolean
  /** Optional list header right controls. If provided, overrides the default skeleton buttons. */
  listHeaderRight?: React.ReactNode

  /** Row skeleton preset. */
  row?: CommonListItemSkeletonProps
}

export function StandardListPageSkeleton(props: StandardListPageSkeletonProps) {
  const rows = props.rows ?? 10
  const titleWidth = props.titleWidthClassName ?? "w-20"
  const withDesktopActions = props.withDesktopActions === true
  const withMobileBar = props.withMobileBar !== false
  const withListHeaderRight = props.withListHeaderRight !== false

  return (
    <div className={cn("space-y-4", props.className)}>
      {/* Header (matches StandardPageHeader layout) */}
      <div className="space-y-4">
        <PageTitleBar
          title={<Skeleton className={cn("h-6", titleWidth)} />}
          description={<Skeleton className="h-4 w-96 max-w-full mt-2 lg:mt-0" />}
          right={
            <div className="min-w-0">
              {/* <lg: search only */}
              <div className="flex items-center gap-2 lg:hidden">
                <Skeleton className="h-8 w-auto flex-1 min-w-0" />
              </div>

              {/* >=lg: search (+ optional actions) */}
              <div className="hidden items-center gap-2 lg:flex">
                <Skeleton className="h-8 w-full text-sm lg:w-[260px]" />
                {props.desktopActions ? (
                  props.desktopActions
                ) : withDesktopActions ? (
                  <Skeleton className="h-9 w-32 shrink-0" />
                ) : null}
              </div>
            </div>
          }
        />

        {withMobileBar ? (
          <div className="flex flex-row items-center justify-between lg:hidden">
            {props.mobileBarLeft ?? <Skeleton className="h-4 w-32" />}
            {props.mobileBarRight ? <div className="flex items-center gap-2">{props.mobileBarRight}</div> : null}
          </div>
        ) : null}
      </div>

      {/* List container (matches ItemsList + ItemListHeader) */}
      <div className="rounded-md border">
        <div className="flex items-center gap-3 border-b bg-muted/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden lg:block">
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
          {withListHeaderRight ? (
            props.listHeaderRight ? (
              <div className="flex items-center gap-2 md:ml-auto">{props.listHeaderRight}</div>
            ) : (
              <div className="flex items-center gap-2 md:ml-auto">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-24" />
              </div>
            )
          ) : null}
        </div>

        {Array.from({ length: rows }).map((_, i) => (
          <div key={`list-sk:${i}`} className="border-b last:border-b-0">
            <CommonListItemSkeleton {...(props.row ?? {})} />
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    </div>
  )
}

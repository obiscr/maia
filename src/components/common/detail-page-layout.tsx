"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type MaxWidth = "full" | "5xl" | "6xl" | "7xl"

function maxWidthClass(maxWidth: MaxWidth) {
  const map: Record<MaxWidth, string> = {
    full: "max-w-none",
    "5xl": "max-w-5xl",
    "6xl": "max-w-6xl",
    "7xl": "max-w-7xl",
  }
  return map[maxWidth]
}

export type DetailPageLayoutProps = {
  /**
   * Global alerts/banners (e.g. load error). Rendered above header.
   * Keep this as a node so callers can compose multiple alerts.
   */
  alert?: React.ReactNode
  /**
   * Dialogs/sheets/portals that should be mounted for the page.
   * Rendered near the top of the page tree (but still inside the page).
   */
  modals?: React.ReactNode
  /** Header node (typically a `StandardPageHeader`). */
  header?: React.ReactNode
  /** Main content. */
  children: React.ReactNode

  /**
   * Constrain page width.
   * Defaults to `full` to match the app's previous "full width" detail pages.
   * Note: overall page padding is owned by the app root scroll container.
   */
  maxWidth?: MaxWidth

  /** Make the header sticky within the app scroll container. */
  stickyHeader?: boolean

  /**
   * Layout mode:
   * - "stack" (default): natural document flow; good for most detail pages.
   * - "fill": header stack + a body region that can take remaining height (min-h-0 flex-1 overflow-hidden).
   *   Use this for "big" pages with tabs/panels/graphs that need controlled overflow.
   */
  variant?: "stack" | "fill"

  className?: string
  bodyClassName?: string
}

/**
 * A real (high-signal) detail page layout:
 * - owns max-width
 * - owns consistent vertical rhythm (space-y-4)
 * - optional sticky header
 * - keeps alert/modals/header/body slots explicit and readable
 */
export function DetailPageLayout(props: DetailPageLayoutProps) {
  const headerNode = props.header ? (
    props.stickyHeader ? (
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {props.header}
      </div>
    ) : (
      props.header
    )
  ) : null

  const variant = props.variant ?? "stack"

  if (variant === "fill") {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col w-full min-w-0 overflow-hidden", props.className)}>
        <div className={cn("mx-auto w-full min-w-0", maxWidthClass(props.maxWidth ?? "full"))}>
          <div className="shrink-0 space-y-4">
            {props.alert}
            {props.modals}
            {headerNode}
          </div>
        </div>

        <div className={cn("mt-4 flex min-h-0 flex-1 flex-col overflow-hidden", props.bodyClassName)}>
          {props.children}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("w-full min-w-0", props.className)}>
      <div className={cn("mx-auto w-full min-w-0", maxWidthClass(props.maxWidth ?? "full"))}>
        <div className="space-y-4">
          {props.alert}
          {props.modals}
          {headerNode}
          {props.children}
        </div>
      </div>
    </div>
  )
}

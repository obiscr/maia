"use client"

import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type InlineItemRowItem = {
  key: string
  /** Main content. Required unless you set iconOnly (and provide an Icon). */
  text?: React.ReactNode
  /** Optional icon shown before text. */
  Icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> | null
  /** If true and Icon is present, only the icon is shown (no text). */
  iconOnly?: boolean

  /** Optional click handler. When provided, the item renders as a button. */
  onClick?: (() => void) | null

  /** Native title attr used when tooltip is not set. */
  title?: string
  /** Tooltip content. If set, title attr is disabled and Tooltip is used. */
  tooltip?: string

  iconClassName?: string
  textClassName?: string

  /** Only used when useBadge=true */
  badgeClassName?: string
  /** Only used when useBadge=true */
  variant?: React.ComponentProps<typeof Badge>["variant"]
}

export function InlineItemRow(props: {
  className?: string
  /** Optional header shown above the items (used by the badge row). */
  title?: React.ReactNode
  items: InlineItemRowItem[]

  /** When true, each item is wrapped in a Badge. When false, items are plain inline elements. */
  useBadge?: boolean
  /** Default badge variant when useBadge=true */
  defaultVariant?: React.ComponentProps<typeof Badge>["variant"]

  wrap?: boolean
  iconSizeClassName?: string
}) {
  if (!props.items.length) return null

  const useBadge = props.useBadge ?? false
  const wrap = props.wrap ?? (useBadge ? true : false)
  const iconSizeClassName = props.iconSizeClassName ?? (useBadge ? "h-3.5 w-3.5" : "size-3.5")
  const defaultVariant = props.defaultVariant ?? "outline"

  const renderContent = (it: InlineItemRowItem) => {
    const Icon = it.Icon ?? null
    const showIconOnly = it.iconOnly === true && !!Icon
    const textNode = showIconOnly ? null : it.text

    if (useBadge) {
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {Icon ? <Icon className={cn(iconSizeClassName, it.iconClassName)} aria-hidden={true} /> : null}
          {textNode !== null && textNode !== undefined ? (
            <span className={cn("min-w-0 font-mono text-[11px]", it.textClassName)}>{textNode}</span>
          ) : null}
        </span>
      )
    }

    return (
      <span className="inline-flex min-w-0 items-center gap-1" title={it.tooltip ? undefined : it.title}>
        {Icon ? <Icon className={cn(iconSizeClassName, it.iconClassName)} aria-hidden={true} /> : null}
        {textNode !== null && textNode !== undefined ? (
          <span className={cn(wrap ? "whitespace-normal break-words" : "truncate", it.textClassName)}>{textNode}</span>
        ) : null}
      </span>
    )
  }

  const renderItem = (it: InlineItemRowItem) => {
    const content = renderContent(it)
    const isClickable = typeof it.onClick === "function"

    if (useBadge) {
      const badge = isClickable ? (
        <Badge
          key={it.key}
          asChild
          variant={it.variant ?? defaultVariant}
          className={cn("w-fit", it.badgeClassName)}
          title={it.tooltip ? undefined : it.title}
        >
          <button
            type="button"
            onClick={it.onClick ?? undefined}
            className={cn(
              "cursor-pointer select-none",
              // Ensure we get a hover affordance for non-link interactive badges.
              "hover:opacity-90",
            )}
          >
            {content}
          </button>
        </Badge>
      ) : (
        <Badge
          key={it.key}
          variant={it.variant ?? defaultVariant}
          className={cn("w-fit", it.badgeClassName)}
          title={it.tooltip ? undefined : it.title}
        >
          {content}
        </Badge>
      )

      if (it.tooltip) {
        return (
          <TooltipProvider key={it.key}>
            <Tooltip>
              <TooltipTrigger asChild>{badge}</TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{it.tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      }

      return badge
    }

    const base = React.cloneElement(content as React.ReactElement<any>, { key: it.key })
    const keyed = isClickable ? (
      <button
        key={it.key}
        type="button"
        onClick={it.onClick ?? undefined}
        className={cn("inline-flex cursor-pointer select-none hover:opacity-90")}
        title={it.tooltip ? undefined : it.title}
      >
        {base}
      </button>
    ) : (
      base
    )
    if (it.tooltip) {
      return (
        <TooltipProvider key={it.key}>
          <Tooltip>
            <TooltipTrigger asChild>{keyed}</TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs">{it.tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }
    return keyed
  }

  return (
    <div className={cn(props.title ? "space-y-2" : undefined, props.className)}>
      {props.title ? <div className="text-xs font-medium text-muted-foreground">{props.title}</div> : null}
      {useBadge ? (
        <div className={cn("flex gap-2", wrap ? "flex-wrap" : "min-w-0 overflow-hidden")}>
          {props.items.map(renderItem)}
        </div>
      ) : (
        <>{props.items.map(renderItem)}</>
      )}
    </div>
  )
}

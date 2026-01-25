"use client"

import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

export type TwoLineMiniCardProps = Omit<React.ComponentProps<"div">, "children"> & {
  /**
   * When provided, the card renders as a Next.js `Link`.
   * This is the recommended way to make the card clickable (instead of `asChild`).
   */
  href?: string
  /** Optional `Link` props (prefetch/replace/scroll/etc) when `href` is provided. */
  linkProps?: Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">
  /** Force hover affordance even without `href`. */
  interactive?: boolean

  /** First row: left title text/node. */
  title: React.ReactNode
  /** First row: right icon/node. */
  titleRight?: React.ReactNode

  /** Second row: optional left icon/node. */
  valueLeft?: React.ReactNode
  /** Second row: main content (usually a text). */
  value: React.ReactNode
  /** Second row: optional right content (e.g. version badge/text). */
  valueRight?: React.ReactNode

  /** Optional title attribute for the value row (tooltip). */
  valueTitle?: string

  titleClassName?: string
  titleRightClassName?: string
  valueClassName?: string
  /** Class for the inner value wrapper (defaults to a truncating span). */
  valueInnerClassName?: string
  valueRowClassName?: string
  valueLeftClassName?: string
  valueRightClassName?: string

  /** Wrap value in a truncating `<span>` (default true). */
  truncate?: boolean
}

/**
 * TwoLineMiniCard
 * A small "field card" with:
 * - row 1: left title, right icon
 * - row 2: content (optionally with a left icon, and/or right-side content)
 */
export function TwoLineMiniCard(props: TwoLineMiniCardProps) {
  const {
    href,
    linkProps,
    interactive: interactiveProp = false,
    className,
    title,
    titleRight,
    valueLeft,
    value,
    valueRight,
    valueTitle,
    titleClassName,
    titleRightClassName,
    valueClassName,
    valueInnerClassName,
    valueRowClassName,
    valueLeftClassName,
    valueRightClassName,
    truncate = true,
    ...rest
  } = props

  const isBetween = Boolean(valueRight)
  const interactive = Boolean(href) || interactiveProp || typeof rest.onClick === "function"

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className={cn("min-w-0 truncate text-xs text-muted-foreground", titleClassName)}>{title}</div>
        {titleRight ? (
          <div className={cn("shrink-0 text-muted-foreground", titleRightClassName)}>{titleRight}</div>
        ) : null}
      </div>

      <div className={cn("mt-1 min-w-0 text-sm font-medium text-foreground", valueClassName)} title={valueTitle}>
        <div className={cn("flex min-w-0 items-center gap-2", isBetween && "justify-between", valueRowClassName)}>
          <div className="flex min-w-0 items-center gap-1.5">
            {valueLeft ? (
              <div className={cn("shrink-0 text-muted-foreground", valueLeftClassName)}>{valueLeft}</div>
            ) : null}
            <div className="min-w-0">
              {truncate ? <span className={cn("block truncate", valueInnerClassName)}>{value}</span> : value}
            </div>
          </div>
          {valueRight ? (
            <div className={cn("shrink-0 text-muted-foreground", valueRightClassName)}>{valueRight}</div>
          ) : null}
        </div>
      </div>
    </>
  )

  const baseClassName = cn(
    "min-w-0 rounded-md font-mono border bg-muted/10 px-3 py-2",
    interactive && "transition-colors hover:bg-muted/10",
    className,
  )

  if (href) {
    return (
      <Link href={href} className={baseClassName} {...linkProps}>
        {inner}
      </Link>
    )
  }

  return (
    <div className={baseClassName} {...rest}>
      {inner}
    </div>
  )
}

"use client"

import * as React from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * OptionalTooltip
 *
 * Design goals:
 * - If `tooltip` is not provided, render children exactly as-is (no wrapper).
 * - If `tooltip` is provided, wrap children with a Tooltip trigger.
 * - Handle disabled interactive children by wrapping trigger in a <span>.
 */
export function OptionalTooltip(props: {
  tooltip?: React.ReactNode
  children: React.ReactElement
  contentClassName?: string
  side?: React.ComponentProps<typeof TooltipContent>["side"]
  align?: React.ComponentProps<typeof TooltipContent>["align"]
  sideOffset?: number
}) {
  const { tooltip, children, contentClassName, side, align, sideOffset } = props

  if (!tooltip) return children

  // Disabled controls (e.g. <button disabled/>) won't emit pointer events, so TooltipTrigger won't fire.
  // Wrap in a span as the trigger and keep the disabled child inside.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn("max-w-[360px] whitespace-pre-line break-words", contentClassName)}
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

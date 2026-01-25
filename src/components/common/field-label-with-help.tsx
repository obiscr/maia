"use client"

import * as React from "react"
import { CircleHelp } from "lucide-react"

import { FieldLabel } from "@/components/ui/field"
import { OptionalTooltip } from "@/components/common/optional-tooltip"
import { cn } from "@/lib/utils"

/**
 * FieldLabelWithHelp
 *
 * A small, reusable pattern for "Label + optional help tooltip".
 * This is intentionally NOT tied to any specific input/select component.
 */
export function FieldLabelWithHelp(props: {
  label: React.ReactNode
  htmlFor?: string
  tooltip?: React.ReactNode
  tooltipAction?:
    | (() => void)
    | {
        label?: React.ReactNode
        onClick: () => void
      }
  className?: string
  labelClassName?: string
  iconClassName?: string
  tooltipSide?: React.ComponentProps<typeof OptionalTooltip>["side"]
}) {
  const { label, htmlFor, tooltip, tooltipAction, className, labelClassName, iconClassName, tooltipSide } = props

  const hasHelp = tooltip != null || tooltipAction != null
  const tooltipActionOnClick =
    typeof tooltipAction === "function" ? tooltipAction : tooltipAction ? tooltipAction.onClick : undefined

  const iconButton = (
    <button
      type="button"
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tooltipActionOnClick ? "cursor-pointer" : undefined,
        iconClassName,
      )}
      aria-label="Help"
      onClick={
        tooltipActionOnClick
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              tooltipActionOnClick()
            }
          : undefined
      }
    >
      <CircleHelp className="size-4" aria-hidden="true" />
    </button>
  )

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <FieldLabel htmlFor={htmlFor} className={cn("min-w-0", labelClassName)}>
        {label}
      </FieldLabel>
      {hasHelp ? (
        tooltip ? (
          <OptionalTooltip tooltip={tooltip} side={tooltipSide} sideOffset={6}>
            {iconButton}
          </OptionalTooltip>
        ) : (
          iconButton
        )
      ) : null}
    </div>
  )
}

"use client"

import type * as React from "react"

import { FieldLabel } from "@/components/ui/field"
import { cn } from "@/lib/utils"

export function FieldHeader(props: {
  className?: string
  titleRowClassName?: string

  /** If set and `title` is a string, it will be rendered as a label linked to this id. */
  htmlFor?: string

  title: React.ReactNode
  required?: boolean
  icon?: React.ReactNode
  codeLabel?: string | null
  hintText?: string | null
  rightSlot?: React.ReactNode
}) {
  const required = props.required === true
  const code = typeof props.codeLabel === "string" && props.codeLabel.trim() ? props.codeLabel.trim() : null
  const hint = typeof props.hintText === "string" && props.hintText.trim() ? props.hintText.trim() : ""

  const titleNode =
    typeof props.title === "string" ? (
      props.htmlFor ? (
        <FieldLabel htmlFor={props.htmlFor} className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
          <span className="truncate">{props.title}</span>
          {required ? <span className="text-destructive">*</span> : null}
        </FieldLabel>
      ) : (
        <div className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
          <span className="truncate">{props.title}</span>
          {required ? <span className="text-destructive">*</span> : null}
        </div>
      )
    ) : (
      props.title
    )

  return (
    <div className={cn("flex items-start justify-between gap-3", props.className)}>
      <div className={cn("min-w-0", props.titleRowClassName)}>
        <div className="flex items-center gap-2">
          {props.icon ? <span className="text-muted-foreground">{props.icon}</span> : null}
          {titleNode}
          {code ? <div className="truncate font-mono text-[11px] text-muted-foreground">{code}</div> : null}
        </div>
        {hint ? <div className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{hint}</div> : null}
      </div>

      {props.rightSlot ? <div className="flex shrink-0 items-center gap-2">{props.rightSlot}</div> : null}
    </div>
  )
}

"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

export function WorkflowSettingsConfigCard(props: {
  title: string
  icon?: React.ReactNode
  value: React.ReactNode
  valueClassName?: string
  footer?: React.ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "w-full rounded-md border bg-muted/10 p-3 text-left transition-colors",
        "hover:bg-muted/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          {props.icon}
          <span>{props.title}</span>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>

      <div className="mt-1 flex items-center flex-wrap justify-start gap-x-3 gap-y-1">
        <div className={cn("text-lg font-semibold leading-none", props.valueClassName)}>{props.value}</div>
        {props.footer ? <div className="shrink-0 leading-none">{props.footer}</div> : null}
      </div>
    </button>
  )
}

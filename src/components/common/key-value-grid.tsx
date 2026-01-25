"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export function KeyValueGrid(props: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0", props.className)}>
      <div className="grid items-baseline grid-cols-[max-content_1fr] gap-x-3 gap-y-1">{props.children}</div>
    </div>
  )
}

function Label(props: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "whitespace-nowrap text-right font-mono text-sm leading-5 text-muted-foreground opacity-80",
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

function Value(props: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        // NOTE: `min-w-0` is critical for grid items to shrink; prevents long tokens from forcing page overflow.
        "min-w-0 whitespace-pre-wrap break-all font-mono text-sm leading-5",
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

function Row(props: {
  label: React.ReactNode
  children: React.ReactNode
  labelClassName?: string
  valueClassName?: string
}) {
  return (
    <>
      <Label className={props.labelClassName}>{props.label}</Label>
      <Value className={props.valueClassName}>{props.children}</Value>
    </>
  )
}

KeyValueGrid.Row = Row
KeyValueGrid.Label = Label
KeyValueGrid.Value = Value

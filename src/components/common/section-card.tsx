import * as React from "react"

import { cn } from "@/lib/utils"

export function SectionCard(props: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border", props.className)}>
      {props.children}
    </div>
  )
}

export function SectionCardHeader(props: { className?: string; children?: React.ReactNode }) {
  if (!props.children) return null
  return <div className={cn("border-b bg-muted/10 px-3 py-2", props.className)}>{props.children}</div>
}

export function SectionCardBody(props: { className?: string; children?: React.ReactNode }) {
  if (!props.children) return null
  return <div className={cn("min-h-0 flex-1", props.className)}>{props.children}</div>
}

export function SectionCardFooter(props: { className?: string; children?: React.ReactNode }) {
  if (!props.children) return null
  return <div className={cn("border-t bg-muted/10 px-3 py-2 text-xs", props.className)}>{props.children}</div>
}

"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { formatShortId, type ShortIdFormatOptions } from "@/lib/shared/format/id"

export function ShortId(
  props: {
    id: string | null | undefined
    /** Provide full ID tooltip/title; defaults to the original id string. */
    title?: string
    className?: string
  } & ShortIdFormatOptions,
) {
  const { id, title, className, head, tail, minLength, ellipsis, emptyPlaceholder } = props

  const full = typeof id === "string" ? id : id == null ? "" : String(id)
  const text = formatShortId(full, { head, tail, minLength, ellipsis, emptyPlaceholder })
  const tt = typeof title === "string" ? title : full.trim() ? full : undefined

  return (
    <span className={cn("font-mono", className)} title={tt}>
      {text}
    </span>
  )
}

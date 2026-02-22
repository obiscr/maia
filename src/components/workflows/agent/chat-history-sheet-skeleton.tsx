"use client"

import * as React from "react"

import { Skeleton } from "@/components/ui/skeleton"

export function ChatHistorySheetSkeleton(props: { rows?: number }) {
  const rows = Math.max(1, Math.min(20, props.rows ?? 8))
  const titleWidths = ["w-24", "w-3/4", "w-32", "w-40", "w-20", "w-28"]
  return (
    <div className="space-y-2 pt-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={`chat-history-sk:${i}`} className="rounded-lg border bg-card p-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className={`h-5 max-w-[85%] ${titleWidths[i % titleWidths.length]}`} />
              <Skeleton className="h-4 w-40 max-w-[65%]" />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

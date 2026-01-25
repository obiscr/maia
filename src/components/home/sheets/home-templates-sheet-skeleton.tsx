"use client"

import * as React from "react"

import { Skeleton } from "@/components/ui/skeleton"

export function HomeTemplatesSheetSkeleton(props: { rows?: number }) {
  const rows = Math.max(1, Math.min(20, props.rows ?? 6))
  return (
    <div className="divide-y rounded-md border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={`sk:${i}`} className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-56 max-w-[70%]" />
            <Skeleton className="h-4 w-96 max-w-[90%]" />
          </div>
          <div className="shrink-0">
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  )
}

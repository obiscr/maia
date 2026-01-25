"use client"

import { Skeleton } from "@/components/ui/skeleton"

export function StepDefinitionSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header matches the real Step Definition header (badge row + actions) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-28 rounded-full" />
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </div>

      {/* body matches CodeViewer: copy action tray + monospace code area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          <Skeleton className="h-full w-full rounded-md" />
        </div>
      </div>
    </div>
  )
}

export function StepLogsSkeleton() {
  return (
    <div className="h-full min-h-0 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-20" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={`logs:sk:${i}`} className="flex items-center gap-3 rounded-md border p-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-[40%]" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function StepAttemptsSkeleton(props: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: props.rows ?? 3 }).map((_, i) => (
        <div key={`attempt:sk:${i}`} className="w-full rounded-md border bg-background">
          {/* Matches StatusCollapsibleCard header (collapsed state) */}
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0 flex items-center gap-2">
              {/* left status icon */}
              <Skeleton className="h-4 w-4 rounded-sm" />
              <div className="min-w-0 flex items-center gap-2">
                {/* title + summary */}
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {/* duration (Clock + text) */}
              <div className="inline-flex items-center gap-1.5">
                <Skeleton className="h-4 w-4 rounded-sm" />
                <Skeleton className="h-4 w-14" />
              </div>
              {/* chevron */}
              <Skeleton className="h-4 w-4 rounded-sm" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

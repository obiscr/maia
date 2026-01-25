"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type PaneSkeleton = {
  headerWidthClassName?: string
  content?: "block" | "list"
  listRows?: number
}

export function TwoColumnSplitPanelSkeleton(props: { className?: string; left?: PaneSkeleton; right?: PaneSkeleton }) {
  const left = props.left ?? {}
  const right = props.right ?? {}

  const leftContent = left.content ?? "block"
  const rightContent = right.content ?? "block"

  return (
    <div className={cn("h-full min-h-0", props.className)}>
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b md:border-b-0 md:border-r">
          <div className="shrink-0 border-b px-3 py-2">
            <Skeleton className={cn("h-4 w-14", left.headerWidthClassName)} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            {leftContent === "list" ? (
              <div className="space-y-2">
                {Array.from({ length: left.listRows ?? 3 }).map((_, i) => (
                  <div key={`sk:left:${i}`} className="flex items-start gap-3 rounded-md border p-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-[85%]" />
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <Skeleton className="h-4 w-20 rounded-full" />
                        <Skeleton className="h-4 w-24 rounded-full" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-16 shrink-0 rounded-md" />
                  </div>
                ))}
              </div>
            ) : (
              <Skeleton className="h-full w-full rounded-md" />
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b px-3 py-2">
            <Skeleton className={cn("h-4 w-14", right.headerWidthClassName)} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            {rightContent === "list" ? (
              <div className="space-y-2">
                {Array.from({ length: right.listRows ?? 3 }).map((_, i) => (
                  <div key={`sk:right:${i}`} className="flex items-start gap-3 rounded-md border p-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-[85%]" />
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <Skeleton className="h-4 w-20 rounded-full" />
                        <Skeleton className="h-4 w-24 rounded-full" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-16 shrink-0 rounded-md" />
                  </div>
                ))}
              </div>
            ) : (
              <Skeleton className="h-full w-full rounded-md" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

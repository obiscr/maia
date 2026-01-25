"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { StandardListPageSkeleton } from "@/components/common/standard-list-page-skeleton"

export function WorkflowListPageSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <StandardListPageSkeleton
      rows={rows}
      titleWidthClassName="w-24"
      desktopActions={
        <>
          <Skeleton className="h-9 w-32 shrink-0" />
          <Skeleton className="h-9 w-32 shrink-0" />
          <Skeleton className="h-9 w-9 shrink-0" />
        </>
      }
      mobileBarRight={
        <>
          <Skeleton className="h-9 w-9 rounded-md md:w-32" />
          <Skeleton className="h-9 w-9 rounded-md md:w-32" />
          <Skeleton className="h-9 w-9 rounded-md shrink-0" />
        </>
      }
      listHeaderRight={
        <>
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
        </>
      }
    />
  )
}

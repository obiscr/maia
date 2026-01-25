"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { StandardListPageSkeleton } from "@/components/common/standard-list-page-skeleton"

export function BatchesListPageSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <StandardListPageSkeleton
      rows={rows}
      titleWidthClassName="w-24"
      withDesktopActions
      mobileBarRight={<Skeleton className="h-9 w-9 rounded-md md:w-32" />}
    />
  )
}

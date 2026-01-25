"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { StandardListPageSkeleton } from "@/components/common/standard-list-page-skeleton"

export function WorkflowVersionsListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <StandardListPageSkeleton
      rows={rows}
      titleWidthClassName="w-40"
      desktopActions={<Skeleton className="h-9 w-40 shrink-0" />}
      mobileBarRight={<Skeleton className="h-9 w-9 rounded-md md:w-40" />}
      listHeaderRight={<Skeleton className="h-8 w-20" />}
      row={{ variant: "versions" }}
    />
  )
}

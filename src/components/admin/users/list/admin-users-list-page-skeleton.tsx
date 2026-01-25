"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { StandardListPageSkeleton } from "@/components/common/standard-list-page-skeleton"

export function AdminUsersListPageSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <StandardListPageSkeleton
      rows={rows}
      titleWidthClassName="w-20"
      listHeaderRight={
        <>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </>
      }
    />
  )
}

"use client"

import { StandardListPageSkeleton } from "@/components/common/standard-list-page-skeleton"

export function JobsListPageSkeleton({ rows = 10 }: { rows?: number }) {
  return <StandardListPageSkeleton rows={rows} titleWidthClassName="w-20" withDesktopActions />
}

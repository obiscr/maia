"use client"

import { StandardListPageSkeleton } from "@/components/common/standard-list-page-skeleton"

export function OperationsListPageSkeleton({ rows = 10 }: { rows?: number }) {
  return <StandardListPageSkeleton rows={rows} titleWidthClassName="w-28" />
}

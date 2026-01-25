"use client"

import { LoadingState } from "@/components/common/loading-state"

export default function Loading() {
  return <LoadingState textKey="common.loading" spinner placement="top" minHeightClassName="min-h-[40vh]" />
}

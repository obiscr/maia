"use client"

import * as React from "react"

import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { HeaderSubbar } from "@/components/common/header-subbar"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { TwoColumnSplitPanelSkeleton } from "@/components/common/two-column-split-panel-skeletons"
import { Skeleton } from "@/components/ui/skeleton"

function MiniFieldSkeleton(props: { titleW?: string; valueW?: string; showTitleRight?: boolean }) {
  const { titleW = "w-20", valueW = "w-40", showTitleRight = true } = props
  return (
    <div className="min-w-0 rounded-md border bg-muted/10 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className={["h-4", titleW].join(" ")} />
        {showTitleRight ? <Skeleton className="h-4 w-4 rounded-sm" /> : null}
      </div>
      <div className="mt-1">
        <Skeleton className={["h-4", valueW].join(" ")} />
      </div>
    </div>
  )
}

function JobOverviewCardSkeleton() {
  return (
    <SectionCard className="flex-none bg-card text-card-foreground">
      <SectionCardHeader>
        <Skeleton className="h-4 w-24" />
      </SectionCardHeader>
      <SectionCardBody className="p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniFieldSkeleton titleW="w-20" valueW="w-28" />
          <MiniFieldSkeleton titleW="w-24" valueW="w-32" />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <MiniFieldSkeleton titleW="w-24" valueW="w-36" />
          <MiniFieldSkeleton titleW="w-24" valueW="w-40" />
          <MiniFieldSkeleton titleW="w-20" valueW="w-48" />
          <MiniFieldSkeleton titleW="w-24" valueW="w-44" />
        </div>
      </SectionCardBody>
    </SectionCard>
  )
}

function JobTimingCardSkeleton() {
  return (
    <SectionCard className="flex-none bg-card text-card-foreground">
      <SectionCardHeader>
        <Skeleton className="h-4 w-20" />
      </SectionCardHeader>
      <SectionCardBody className="p-3">
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <MiniFieldSkeleton key={`job:timing:sk:${i}`} titleW="w-24" valueW="w-44" />
          ))}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <MiniFieldSkeleton titleW="w-24" valueW="w-32" />
          <MiniFieldSkeleton titleW="w-24" valueW="w-36" />
        </div>
      </SectionCardBody>
    </SectionCard>
  )
}

function JobLeaseCardSkeleton() {
  return (
    <SectionCard className="flex-none bg-card text-card-foreground">
      <SectionCardHeader>
        <Skeleton className="h-4 w-28" />
      </SectionCardHeader>
      <SectionCardBody className="p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <MiniFieldSkeleton titleW="w-20" valueW="w-24" />
          <MiniFieldSkeleton titleW="w-28" valueW="w-40" />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <MiniFieldSkeleton titleW="w-24" valueW="w-36" />
          <MiniFieldSkeleton titleW="w-24" valueW="w-36" />
          <MiniFieldSkeleton titleW="w-24" valueW="w-44" />
          <MiniFieldSkeleton titleW="w-28" valueW="w-48" />
        </div>
      </SectionCardBody>
    </SectionCard>
  )
}

function JobRelatedCardSkeleton() {
  return (
    <SectionCard className="flex-none bg-card text-card-foreground">
      <SectionCardHeader>
        <Skeleton className="h-4 w-24" />
      </SectionCardHeader>
      <SectionCardBody className="p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <MiniFieldSkeleton titleW="w-24" valueW="w-40" />
          <MiniFieldSkeleton titleW="w-20" valueW="w-44" />
        </div>
      </SectionCardBody>
    </SectionCard>
  )
}

export function JobInputsInlineLoadingSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-32" />
    </div>
  )
}

export function JobAttemptsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={`job:attempt:sk:${i}`} className="rounded-md border p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-5 w-30 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <div className="gap-2 flex items-end">
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

"use client"

import * as React from "react"

import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { HeaderSubbar } from "@/components/common/header-subbar"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

function MiniStatCardSkeleton(props: { titleW?: string; valueW?: string; showTitleRight?: boolean }) {
  const { titleW = "w-20", valueW = "w-16", showTitleRight = true } = props
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

function BatchSummaryCardSkeleton() {
  return (
    <SectionCard className="flex-none text-card-foreground">
      <SectionCardHeader>
        <Skeleton className="h-4 w-20" />
      </SectionCardHeader>
      <SectionCardBody className="p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <MiniStatCardSkeleton key={`batch:summary:sk:${i}`} titleW="w-16" valueW="w-12" />
          ))}
        </div>
      </SectionCardBody>
    </SectionCard>
  )
}

function BatchSettingsCardSkeleton() {
  return (
    <SectionCard className="flex-none text-card-foreground">
      <SectionCardHeader>
        <Skeleton className="h-4 w-20" />
      </SectionCardHeader>
      <SectionCardBody className="p-3 space-y-4">
        {/* Quick summary mini cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <MiniStatCardSkeleton key={`batch:settings:summary:sk:${i}`} titleW="w-24" valueW="w-20" />
          ))}
        </div>

        <div className="h-px w-full bg-border" />

        {/* Editable controls (approximate layout) */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Skeleton className="h-5 w-40" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>

        <div className="grid gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-28 w-full" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </SectionCardBody>
    </SectionCard>
  )
}

function FanoutCardSkeleton() {
  return (
    <SectionCard className="flex-none text-card-foreground">
      <SectionCardHeader>
        <Skeleton className="h-4 w-24" />
      </SectionCardHeader>
      <SectionCardBody className="p-3 space-y-3">
        {/* Inputs area (editor; other inputs are conditional in real UI) */}
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-[450px] w-full rounded-md" />
          </div>
        </div>

        {/* Sharding controls */}
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="grid gap-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>

        {/* Start now + enqueue */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </SectionCardBody>
    </SectionCard>
  )
}

function BatchJobsListSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <StandardPageHeader
          title={<Skeleton className="h-6 w-32" />}
          description={null}
          right={
            <div className="min-w-0">
              <div className="flex items-center gap-2 lg:hidden">
                <Skeleton className="h-8 w-auto flex-1 min-w-0" />
              </div>
              <div className="hidden items-center gap-2 lg:flex">
                <Skeleton className="h-8 w-full text-sm lg:w-[260px]" />
              </div>
            </div>
          }
          bottom={
            <div className="flex flex-row items-center justify-between lg:hidden">
              <Skeleton className="h-4 w-32" />
            </div>
          }
        />
      </div>

      <div className="rounded-md border">
        <div className="flex items-center gap-3 border-b bg-muted/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden lg:block">
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
          <div className="flex items-center gap-2 md:ml-auto">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>

        {Array.from({ length: rows }).map((_, i) => (
          <div key={`batch:jobs:sk:${i}`} className="border-b last:border-b-0">
            <CommonListItemSkeleton />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    </div>
  )
}

export function FanoutSectionInlineSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-[450px] w-full rounded-md" />
      </div>
    </div>
  )
}

"use client"

import { CollapsibleSectionCard } from "@/components/common/collapsible-section-card"
import { Skeleton } from "@/components/ui/skeleton"
import type { TFunction } from "@/lib/shared/i18n/t"

function ParamsEditorSkeleton() {
  return (
    <div className="grid gap-3">
      {/* Tabs bar (Form / JSON) */}
      <Skeleton className="h-9 w-full" />

      {/* Representative form fields */}
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-9 w-full" />
        </div>

        <div className="grid gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>

        <div className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>

        <div className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-44" />
        </div>

        <div className="grid gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  )
}

function FilesInputSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-20 w-full" />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  )
}

export function JobInputsSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="h-32 w-full" />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  )
}

export function NewJobSheetSkeleton(props: { t: TFunction }) {
  const { t } = props

  return (
    <div className="space-y-3 px-4 pb-4">
      <CollapsibleSectionCard
        title={t("jobs.selectWorkflowTitle")}
        icon={<span className="text-muted-foreground">①</span>}
        defaultOpen
        bodyClassName="p-4"
        toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
      >
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </CollapsibleSectionCard>

      <CollapsibleSectionCard
        title={t("common.inputParams")}
        icon={<span className="text-muted-foreground">②</span>}
        defaultOpen
        bodyClassName="p-4"
        toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
      >
        <div className="grid gap-4">
          <ParamsEditorSkeleton />
          <FilesInputSkeleton />
        </div>
      </CollapsibleSectionCard>
    </div>
  )
}

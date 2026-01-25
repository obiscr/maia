"use client"

import { Link2 } from "lucide-react"

import { CollapsibleSectionCard } from "@/components/common/collapsible-section-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { TFunction } from "@/lib/shared/i18n/t"

export function ScheduleInputsSkeleton() {
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

export function SheetSkeleton(props: { t: TFunction }) {
  const { t } = props

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <CollapsibleSectionCard
          title={t("schedules.sections.basic")}
          icon={<span className="text-muted-foreground">①</span>}
          defaultOpen
          bodyClassName="p-4"
          toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
        >
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>

            <div className="grid gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          title={t("common.scheduleRule")}
          icon={<span className="text-muted-foreground">②</span>}
          defaultOpen
          bodyClassName="p-4"
          toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
        >
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="grid gap-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>

            {/* Default "CRON" fields */}
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="grid gap-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </div>
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          title={t("common.executionPolicies")}
          icon={<span className="text-muted-foreground">③</span>}
          bodyClassName="p-4"
          toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
        >
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="grid gap-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>

            <div className="grid gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-9 w-full" />
            </div>

            <div className="grid gap-2">
              <Skeleton className="h-5 w-48" />
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </div>
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          title={t("common.inputs")}
          icon={<span className="text-muted-foreground">④</span>}
          bodyClassName="p-4"
          toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
        >
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
                <div className="flex min-w-0 items-center gap-2">
                  <Link2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Badge variant="outline" className="text-[10px]">
                  <Skeleton className="h-3 w-24" />
                </Badge>
              </div>
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        </CollapsibleSectionCard>
      </div>
    </div>
  )
}

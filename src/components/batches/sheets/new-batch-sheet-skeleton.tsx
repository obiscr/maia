"use client"

import { Braces } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { TFunction } from "@/lib/shared/i18n/t"
import { CollapsibleSectionCard } from "@/components/common/collapsible-section-card"
import { Badge } from "@/components/ui/badge"

export function SheetSkeleton(props: { t: TFunction }) {
  const { t } = props
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <CollapsibleSectionCard
          title={t("batches.sections.basic")}
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

            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </div>
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          title={t("common.executionPolicies")}
          icon={<span className="text-muted-foreground">②</span>}
          defaultOpen
          bodyClassName="p-4"
          toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
        >
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="grid gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="grid gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </div>
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          title={t("batches.sections.provenance")}
          icon={<Braces className="size-3.5 text-muted-foreground" aria-hidden="true" />}
          right={
            <Badge variant="outline" className="text-[10px]">
              <Skeleton className="h-3 w-10" />
            </Badge>
          }
          bodyClassName="p-4"
          toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
        >
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-9 w-full" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="grid gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>

            <div className="grid gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-20 w-full" />
            </div>

            <div className="grid gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
        </CollapsibleSectionCard>
      </div>
    </div>
  )
}

import { CommonListItem } from "@/components/common/common-list-item"
import { Skeleton } from "@/components/ui/skeleton"

export type CommonListItemSkeletonProps = {
  /**
   * - `default`: standard list row (left + middle + kebab actions)
   * - `versions`: workflow versions list row (single column + primary action + kebab)
   */
  variant?: "default" | "versions"
  /**
   * Only applies to `default` variant. Defaults to `true`.
   * (Most list pages use the same 2-column layout.)
   */
  withMiddle?: boolean
}

export function CommonListItemSkeleton(props: CommonListItemSkeletonProps) {
  const variant = props.variant ?? "default"

  if (variant === "versions") {
    const left = (
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-20 max-w-[70%]" />
          </div>
        </div>

        <div className="pl-7 text-sm text-muted-foreground line-clamp-1">
          <Skeleton className="h-4 w-48 max-w-[85%]" />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground">
          <Skeleton className="h-4 w-10 hidden md:block" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-10 md:hidden" />
        </div>
      </div>
    )

    const actions = (
      <div className="shrink-0 self-start pt-0.5">
        {/* Mobile: dropdown */}
        <div className="sm:hidden">
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        {/* Desktop/tablet: buttons */}
        <div className="hidden items-center gap-2 sm:flex">
          <Skeleton className="h-8 w-32 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>
    )

    return <CommonListItem columns={[{ key: "left", content: left, showOnMobile: true }]} actions={actions} />
  }

  const left = (
    <div className="min-w-0 space-y-2">
      {/* Title row */}
      <div className="flex min-w-0 items-center gap-2">
        <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-56 max-w-[70%]" />
        </div>
      </div>

      {/* Description row */}
      <div className="pl-7 text-sm text-muted-foreground line-clamp-1">
        <Skeleton className="h-4 w-64 max-w-[85%]" />
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground">
        <Skeleton className="h-4 w-28 hidden md:block" />
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-4 w-16 md:hidden" />
      </div>

      {/* Mobile-only: counts row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground md:hidden">
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-4 w-8" />
        <Skeleton className="h-4 w-8" />
      </div>

      {/* Mobile-only: updatedAt row */}
      <div className="flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground md:hidden">
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-14" />
      </div>
    </div>
  )

  const withMiddle = props.withMiddle ?? true
  const middle = (
    <div className="flex flex-col items-start gap-1 pt-0.5 text-xs text-muted-foreground">
      <Skeleton className="h-4 w-10" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-14" />
    </div>
  )

  const middleCollapsed = (
    <div className="flex min-w-0 items-center gap-3">
      <Skeleton className="h-4 w-10" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-14" />
    </div>
  )

  return (
    <CommonListItem
      columns={[
        { key: "left", content: left, showOnMobile: true },
        ...(withMiddle
          ? [
              {
                key: "middle",
                content: middle,
                collapsedContent: middleCollapsed,
                minWidthPx: 200,
                collapsePriority: 50,
              },
            ]
          : []),
      ]}
      actions={
        <div className="pt-0.5">
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      }
    />
  )
}

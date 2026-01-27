import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { Skeleton } from "@/components/ui/skeleton"

export function WorkflowVersionSnapshotTabsPanelSkeleton(props: { className?: string }) {
  return (
    <SectionCard className={props.className}>
      <SectionCardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-6 w-40 rounded-full" />
        </div>
      </SectionCardHeader>

      <SectionCardBody className="overflow-hidden">
        <div className="flex h-full min-h-0 flex-col gap-0">
          {/* Tabs bar */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <div className="flex w-max items-center gap-2">
                <Skeleton className="h-9 w-24 rounded-md" />
                <Skeleton className="h-9 w-24 rounded-md" />
                <Skeleton className="h-9 w-24 rounded-md" />
                <Skeleton className="h-9 w-28 rounded-md" />
                <Skeleton className="h-9 w-28 rounded-md" />
              </div>
            </div>
          </div>

          {/* Content (default: Steps tab layout) */}
          <div className="flex h-full min-h-0 flex-col md:flex-row">
            {/* Left: steps list */}
            <div className="min-h-0 flex-1 overflow-hidden border-b md:w-[300px] md:flex-none md:border-b-0 md:border-r">
              <div className="h-full space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={`wfver:steps:sk:${i}`} className="rounded-md border p-3">
                    <Skeleton className="h-4 w-48" />
                    <div className="mt-2 flex gap-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: code preview */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
                <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <Skeleton className="h-6 w-28" />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Skeleton className="h-6 w-28 rounded-full" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <Skeleton className="h-full w-full rounded-none" />
              </div>
            </div>
          </div>
        </div>
      </SectionCardBody>
    </SectionCard>
  )
}

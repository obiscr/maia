"use client"

import * as React from "react"

import { CodeViewer } from "@/components/common/code-viewer"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { ItemCard, ItemCardHeader, ItemCardTitle } from "@/components/common/item-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useI18n } from "@/components/i18n-provider"
import { formatDurationMs } from "@/lib/shared/format/time"

export type WorkflowStepsCodePreviewStep = {
  stepKey: string
  name: string
  timeoutMs: number
  scriptEsm: string
}

export function WorkflowStepsCodePreview(props: {
  className?: string
  steps: WorkflowStepsCodePreviewStep[]
  emptyText?: string
  layout?: "responsive" | "mobile"
}) {
  const { t } = useI18n()

  const [selectedStepKey, setSelectedStepKey] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!props.steps.length) {
      setSelectedStepKey(null)
      return
    }
    setSelectedStepKey((prev) => {
      if (prev && props.steps.some((s) => s.stepKey === prev)) return prev
      return props.steps[0]?.stepKey ?? null
    })
  }, [props.steps])

  const selectedStep = React.useMemo(() => {
    if (!selectedStepKey) return null
    return props.steps.find((s) => s.stepKey === selectedStepKey) ?? null
  }, [props.steps, selectedStepKey])

  const layout = props.layout ?? "responsive"
  const split = layout === "responsive"

  return (
    <div className={["min-h-0", props.className ?? ""].join(" ")}>
      <div className={["flex h-full min-h-0 flex-col", split ? "md:flex-row" : ""].join(" ")}>
        {/* Left: steps list */}
        <div
          className={[
            "min-h-0 flex-1 overflow-hidden border-b",
            split ? "md:w-[300px] md:flex-none md:border-b-0 md:border-r" : "",
          ].join(" ")}
        >
          <ScrollArea className="h-full">
            <div className="divide-y divide-border md:divide-y-0 md:space-y-2 md:p-3">
              {props.steps.length ? (
                props.steps.map((s) => {
                  const active = s.stepKey === selectedStepKey
                  return (
                    <ItemCard
                      key={s.stepKey}
                      asChild
                      className={[
                        "rounded-none border-0 md:rounded-md md:border",
                        active ? "bg-muted/40" : "hover:bg-muted/30",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedStepKey(s.stepKey)}
                        className="w-full p-2 md:p-3 text-left"
                      >
                        <ItemCardHeader className="gap-2 p-0">
                          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3">
                            <ItemCardTitle className="text-sm font-medium leading-snug">
                              <span className="line-clamp-1">{s.name || s.stepKey}</span>
                            </ItemCardTitle>
                          </div>
                        </ItemCardHeader>
                      </button>
                    </ItemCard>
                  )
                })
              ) : (
                <div className="p-3 text-sm text-muted-foreground">
                  {props.emptyText ?? t("workflows.importExport.empty.noSteps")}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: code preview */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className=" shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 flex">
            <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0 truncate text-sm font-semibold">
                {selectedStep ? selectedStep.name || selectedStep.stepKey : t("workflows.versions.noStepSelected")}
              </div>

              {selectedStep ? (
                <div className="flex justify-end">
                  <InlineItemRow
                    className="min-w-0"
                    useBadge={true}
                    wrap={true}
                    iconSizeClassName="size-3.5"
                    defaultVariant="secondary"
                    items={[
                      {
                        key: "timeout",
                        text: t("workflows.versions.stepTimeout", {
                          duration: formatDurationMs(selectedStep.timeoutMs),
                        }),
                        badgeClassName: "h-6 max-w-[220px] font-mono text-xs",
                        textClassName: "block min-w-0 truncate text-xs",
                        title: t("workflows.versions.stepTimeout", {
                          duration: formatDurationMs(selectedStep.timeoutMs),
                        }),
                      },
                      {
                        key: "stepKey",
                        text: String(selectedStep.stepKey),
                        badgeClassName: "h-6 max-w-[220px] font-mono text-xs",
                        textClassName: "block min-w-0 truncate text-xs",
                        title: String(selectedStep.stepKey),
                      },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeViewer code={selectedStep?.scriptEsm || ""} language="javascript" className="h-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

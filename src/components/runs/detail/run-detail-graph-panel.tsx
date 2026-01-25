"use client"

import * as React from "react"
import { Clock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { WorkflowGraphCanvasWrapper } from "@/components/graph/workflow-graph-canvas-wrapper"
import { type WorkflowGraphStep } from "@/components/graph/workflow-graph-canvas"
import { useI18n } from "@/components/i18n-provider"
import { formatDurationMs } from "@/lib/shared/format/time"

export function RunDetailGraphPanel(props: {
  className?: string
  steps: WorkflowGraphStep[]
  runStatus: string
  runDurationMs: number | null

  followProgress: boolean
  onToggleFollow: () => void

  stepStatusByKey: Record<string, string>
  stepDurationMsByKey: Record<string, number | null | undefined>
  highlightStepKeys: string[]

  selectedStepKey: string | null
  onSelectStepKey: (k: string) => void

  onRetryStep: (k: string) => void
  onRerunStep: (k: string) => void
  onRestartFromStep: (k: string) => void
  onViewStepLogs?: (k: string) => void
  onViewStepOutput?: (k: string) => void
  onViewStepDefinition?: (k: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className={props.className}>
      <WorkflowGraphCanvasWrapper
        steps={props.steps}
        mode="view"
        frame={false}
        showLayoutMenu={false}
        controls={{
          interaction: false,
          layout: false,
          fit: true,
          zoom: true,
        }}
        headerLeft={
          <div className="flex min-w-0 items-center gap-3">
            <div className="truncate text-sm font-semibold">{t("common.steps")}</div>
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {t("runs.duration")} {formatDurationMs(props.runDurationMs)}
              </span>
            </span>
          </div>
        }
        headerRight={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={props.onToggleFollow}
              className={props.followProgress ? "bg-muted/60" : ""}
            >
              {props.followProgress ? t("runs.unfollowProgressAction") : t("runs.followProgressAction")}
            </Button>
          </div>
        }
        className="h-full w-full"
        stepStatusByKey={props.stepStatusByKey}
        stepDurationMsByKey={props.stepDurationMsByKey}
        highlightStepKeys={props.highlightStepKeys}
        focusStepKey={props.followProgress ? props.selectedStepKey : null}
        onRetryStep={props.onRetryStep}
        onRerunStep={props.onRerunStep}
        onRestartFromStep={props.onRestartFromStep}
        onViewStepLogs={props.onViewStepLogs}
        onViewStepOutput={props.onViewStepOutput}
        onViewStepDefinition={props.onViewStepDefinition}
        onEditStep={(k) => props.onSelectStepKey(k)}
        selectedStepKeys={props.selectedStepKey ? [props.selectedStepKey] : []}
        onSelectedStepKeysChange={(ks) => {
          const k = ks?.[0] ?? null
          if (!k) return
          props.onSelectStepKey(k)
        }}
      />
    </div>
  )
}

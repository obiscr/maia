"use client"

import * as React from "react"
import Link from "next/link"
import { Bot, Plus, Trash2Icon } from "lucide-react"

import { AgentButton } from "@/components/ui/agent-button"
import { Button } from "@/components/ui/button"
import { StandardConfirmDialog } from "@/components/common/standard-confirm-dialog"
import { useI18n } from "@/components/i18n-provider"
import { WorkflowGraphCanvasControls } from "@/components/graph/workflow-graph-canvas-controls"
import { useStandardDialog } from "@/hooks/use-standard-dialog"
import type { WorkflowLayoutPresetKey } from "@/lib/client/workflow-layout-store"

export function WorkflowGraphCanvasOverlay(props: {
  showToolbar: boolean
  readonly: boolean
  workflowId: string | null
  interactionMode: "pan" | "select"
  layoutDirection: "LR" | "TB"
  layoutPreset: WorkflowLayoutPresetKey
  showLayoutDropdown: boolean
  allowCustom: boolean
  selectedCount: number
  onAddStep?: () => void
  onDeleteSelectedSteps?: () => void
  actions: {
    setInteractionMode: (mode: "pan" | "select") => void
    fitReadable: () => void
    zoomIn: () => void
    zoomOut: () => void
    selectLayoutPreset: (preset: WorkflowLayoutPresetKey) => "ok" | "blocked"
    resetCustomLayout: () => void
  }
}) {
  const { t } = useI18n()

  const resetCustomDialog = useStandardDialog()

  return (
    <>
      <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
        {/* Left controls (edit only) */}
        {props.showToolbar ? (
          <div className="flex flex-wrap items-center gap-2">
            {props.workflowId ? (
              <AgentButton asChild size="sm">
                <Link href={`/agent?workflowId=${encodeURIComponent(props.workflowId)}`}>
                  <Bot className="size-4" />
                  {t("workflows.aiOrchestrateAction")}
                </Link>
              </AgentButton>
            ) : null}

            <Button variant="secondary" size="sm" onClick={props.onAddStep}>
              <Plus className="size-4" />
              {t("workflows.addStepAction")}
            </Button>
          </div>
        ) : (
          <div />
        )}

        {/* Right controls */}
        <WorkflowGraphCanvasControls
          ui={{
            interactionMode: props.interactionMode,
            layoutDirection: props.layoutDirection,
            layoutPreset: props.layoutPreset,
            showLayoutDropdown: props.showLayoutDropdown,
            allowCustom: props.allowCustom,
          }}
          showInteraction={props.showToolbar}
          showLayout
          showFit
          showZoom
          showLayoutReset={props.showToolbar}
          onPan={() => props.actions.setInteractionMode("pan")}
          onSelect={() => props.actions.setInteractionMode("select")}
          onLayoutChange={(v) => {
            props.actions.selectLayoutPreset(v)
          }}
          onOpenReset={() => resetCustomDialog.openDialog()}
          onFit={props.actions.fitReadable}
          onZoomIn={props.actions.zoomIn}
          onZoomOut={props.actions.zoomOut}
        />
      </div>

      {props.showToolbar ? (
        <StandardConfirmDialog
          open={resetCustomDialog.open}
          onOpenChange={resetCustomDialog.onOpenChange}
          title={t("workflows.layoutResetAction")}
          description={t("workflows.layoutResetActionDescription")}
          confirmVariant="destructive"
          confirmIcon={<Trash2Icon className="size-4" />}
          onConfirm={async () => {
            await resetCustomDialog.confirm(() => {
              props.actions.resetCustomLayout()
            })
          }}
          pending={resetCustomDialog.pending}
        />
      ) : null}
    </>
  )
}

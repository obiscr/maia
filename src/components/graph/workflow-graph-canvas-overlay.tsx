"use client"

import * as React from "react"
import Link from "next/link"
import { Bot, Plus, RefreshCcw, Trash2Icon } from "lucide-react"

import { AgentButton } from "@/components/ui/agent-button"
import { Button } from "@/components/ui/button"
import { StandardActionDialog } from "@/components/common/standard-action-dialog"
import { StandardConfirmDialog } from "@/components/common/standard-confirm-dialog"
import { useI18n } from "@/components/i18n-provider"
import { WorkflowGraphCanvasControls } from "@/components/graph/workflow-graph-canvas-controls"
import { useStandardDialog } from "@/hooks/use-standard-dialog"
import { toast } from "@/lib/client/toast"
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
  hasOutdatedCustom: boolean
  selectedCount: number
  onAddStep?: () => void
  onDeleteSelectedSteps?: () => void
  actions: {
    setInteractionMode: (mode: "pan" | "select") => void
    fitReadable: () => void
    zoomIn: () => void
    zoomOut: () => void
    selectLayoutPreset: (preset: WorkflowLayoutPresetKey) => "ok" | "blocked" | "outdated"
    resetCustomLayout: () => void
    clearOutdatedCustom: () => void
    rebuildCustomLayout: () => void
  }
}) {
  const { t } = useI18n()

  const resetCustomDialog = useStandardDialog()
  const [customOutdatedOpen, setCustomOutdatedOpen] = React.useState(false)

  return (
    <>
      <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
        {/* Left controls (edit only) */}
        {props.showToolbar ? (
          <div className="flex flex-wrap items-center gap-2">
            {props.workflowId ? (
              <AgentButton asChild size="sm">
                <Link href={`/workflows/${props.workflowId}/agent`}>
                  <Bot className="size-4" />
                  {t("workflows.aiOrchestrateAction")}
                </Link>
              </AgentButton>
            ) : null}

            <Button variant="secondary" size="sm" onClick={props.onAddStep}>
              <Plus className="size-4" />
              {t("workflows.addStepAction")}
            </Button>

            {props.selectedCount ? (
              <Button variant="destructive" size="sm" onClick={props.onDeleteSelectedSteps} className="shadow-sm">
                <Trash2Icon className="size-4" />
                {`${t("common.deleteAction")} (${props.selectedCount})`}
              </Button>
            ) : null}
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
            const res = props.actions.selectLayoutPreset(v)
            if (res === "outdated") setCustomOutdatedOpen(true)
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

      <StandardActionDialog
        open={customOutdatedOpen}
        onOpenChange={setCustomOutdatedOpen}
        title={t("workflows.layoutCustomOutdatedTitle")}
        description={t("workflows.layoutCustomOutdatedDescription")}
        actions={[
          { key: "cancel", kind: "cancel", label: t("common.cancelAction") },
          {
            key: "reset",
            label: t("workflows.layoutCustomOutdatedResetAction"),
            icon: <Trash2Icon className="h-4 w-4" />,
            variant: "destructive",
            onClick: () => {
              props.actions.clearOutdatedCustom()
              setCustomOutdatedOpen(false)
              toast.success(t("workflows.layoutCustomClearedToast"))
            },
          },
          {
            key: "rebuild",
            label: t("workflows.layoutCustomOutdatedRebuildAction"),
            icon: <RefreshCcw className="h-4 w-4" />,
            onClick: () => {
              props.actions.rebuildCustomLayout()
              setCustomOutdatedOpen(false)
              toast.success(t("workflows.layoutCustomRebuiltToast"))
            },
          },
        ]}
      />
    </>
  )
}

"use client"

import * as React from "react"
import { Trash2Icon } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { StandardConfirmDialog } from "@/components/common/standard-confirm-dialog"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { cn } from "@/lib/utils"
import type { WorkflowLayoutPresetKey } from "@/lib/client/workflow-layout-store"
import { WorkflowGraphCanvasControls } from "@/components/graph/workflow-graph-canvas-controls"
import {
  WorkflowGraphCanvasCoreWithRef,
  type WorkflowGraphCanvasHandle,
  type WorkflowGraphStep,
} from "@/components/graph/workflow-graph-canvas"
import { ReactFlowProvider } from "reactflow"

export function WorkflowGraphCanvasWrapper(props: {
  steps: WorkflowGraphStep[]
  mode?: "view" | "edit"
  className?: string
  workflowId?: string
  /**
   * Wrapper always frames with header+body. For an unframed look, pass frame={false}.
   */
  frame?: boolean

  forceAutoFit?: boolean
  showLayoutMenu?: boolean
  allowCustomLayout?: boolean

  /**
   * Optional header slots. Wrapper renders a standard header bar with:
   * - left: `headerLeft`
   * - right: `headerRight` + built-in control groups (as enabled)
   */
  headerLeft?: React.ReactNode
  headerRight?: React.ReactNode
  showHeader?: boolean

  /**
   * Built-in control groups (right side). Each group can be shown/hidden.
   * - interaction: Pan/Select toggle
   * - layout: layout preset dropdown (if available)
   * - fit: "Fit view" button
   * - zoom: zoom in/out buttons
   */
  controls?: Partial<{
    interaction: boolean
    layout: boolean
    fit: boolean
    zoom: boolean
  }>

  /**
   * When true, show the "Reset custom layout" action in the layout dropdown.
   * Useful for edit pages; should typically be false for read-only pages.
   */
  showLayoutReset?: boolean
  enableNodeContextMenu?: boolean
  enableEditCanvasContextMenu?: boolean
  onRequestClearCanvas?: () => void

  // Run-specific decorations (pass-through)
  stepStatusByKey?: Record<string, string | undefined>
  stepDurationMsByKey?: Record<string, number | null | undefined>
  highlightStepKeys?: string[]
  focusStepKey?: string | null
  onRetryStep?: (stepKey: string) => void
  onRerunStep?: (stepKey: string) => void
  onRestartFromStep?: (stepKey: string) => void
  onViewStepLogs?: (stepKey: string) => void
  onViewStepOutput?: (stepKey: string) => void
  onViewStepDefinition?: (stepKey: string) => void

  // Graph editing events (pass-through)
  onEditStep?: (stepKey: string) => void
  onDeleteStep?: (stepKey: string) => void
  onConnectSteps?: (sourceStepKey: string, targetStepKey: string) => void
  onDisconnectSteps?: (sourceStepKey: string, targetStepKey: string) => void

  selectedStepKeys?: string[]
  onSelectedStepKeysChange?: (stepKeys: string[]) => void
  onDeleteSelectedSteps?: () => void
}) {
  const { t } = useI18n()
  const frame = props.frame ?? true
  const showHeader = props.showHeader ?? true

  const canvasRef = React.useRef<WorkflowGraphCanvasHandle | null>(null)
  const [ui, setUi] = React.useState<ReturnType<WorkflowGraphCanvasHandle["getUiState"]> | null>(null)

  const [resetConfirmOpen, setResetConfirmOpen] = React.useState(false)

  const mode = props.mode ?? "view"

  const controls = props.controls ?? {}
  const showInteraction = controls.interaction ?? mode === "edit"
  const showLayout = controls.layout ?? true
  const showFit = controls.fit ?? true
  const showZoom = controls.zoom ?? true

  const showLayoutReset = props.showLayoutReset ?? mode === "edit"

  const fit = React.useCallback(() => canvasRef.current?.fitReadable(), [])
  const zoomIn = React.useCallback(() => canvasRef.current?.zoomIn(), [])
  const zoomOut = React.useCallback(() => canvasRef.current?.zoomOut(), [])

  const setPan = React.useCallback(() => canvasRef.current?.setInteractionMode("pan"), [])
  const setSelect = React.useCallback(() => canvasRef.current?.setInteractionMode("select"), [])

  const onLayoutChange = React.useCallback((v: WorkflowLayoutPresetKey) => {
    canvasRef.current?.selectLayoutPreset(v)
  }, [])

  const openReset = React.useCallback(() => setResetConfirmOpen(true), [])
  const confirmReset = React.useCallback(() => {
    canvasRef.current?.resetCustomLayout()
    setResetConfirmOpen(false)
  }, [])

  const headerControls = React.useMemo(() => {
    const controls: React.ReactNode[] = []

    if (props.headerRight) controls.push(<React.Fragment key="headerRight">{props.headerRight}</React.Fragment>)

    if (showInteraction || showLayout || showFit || showZoom) {
      controls.push(
        <WorkflowGraphCanvasControls
          key="graphControls"
          ui={
            ui
              ? {
                  interactionMode: ui.interactionMode,
                  layoutDirection: ui.layoutDirection,
                  layoutPreset: ui.layoutPreset,
                  showLayoutDropdown: ui.showLayoutDropdown,
                  allowCustom: ui.allowCustom,
                }
              : null
          }
          showInteraction={showInteraction}
          showLayout={showLayout}
          showFit={showFit}
          showZoom={showZoom}
          showLayoutReset={showLayoutReset}
          onPan={setPan}
          onSelect={setSelect}
          onLayoutChange={onLayoutChange}
          onOpenReset={openReset}
          onFit={fit}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
        />,
      )
    }

    return controls
  }, [
    onLayoutChange,
    openReset,
    props.headerRight,
    setPan,
    setSelect,
    showFit,
    showInteraction,
    showLayout,
    showLayoutReset,
    showZoom,
    ui,
    zoomIn,
    zoomOut,
    fit,
  ])

  const headerNode = showHeader ? (
    <SectionCardHeader
      className={cn("flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-2", frame ? "" : "bg-transparent")}
    >
      {/* Left side (may include its own flex wrappers) */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">{props.headerLeft}</div>

      {/* Spacer: collapses to 0px before any trailing controls are forced to wrap. */}
      <div className="min-w-0 flex-1 basis-0" />

      {headerControls}
    </SectionCardHeader>
  ) : null

  const bodyNode = (
    <SectionCardBody className="relative flex-1 min-h-0">
      <div className="absolute inset-0">
        <ReactFlowProvider>
          <WorkflowGraphCanvasCoreWithRef
            ref={canvasRef}
            disableOverlay
            onUiStateChange={setUi}
            steps={props.steps}
            mode={props.mode}
            frame={false}
            workflowId={props.workflowId}
            enableNodeContextMenu={props.enableNodeContextMenu}
            enableEditCanvasContextMenu={props.enableEditCanvasContextMenu}
            onRequestClearCanvas={props.onRequestClearCanvas}
            onRequestLayoutPreset={onLayoutChange}
            forceAutoFit={props.forceAutoFit}
            showLayoutMenu={props.showLayoutMenu}
            allowCustomLayout={props.allowCustomLayout}
            stepStatusByKey={props.stepStatusByKey}
            stepDurationMsByKey={props.stepDurationMsByKey}
            highlightStepKeys={props.highlightStepKeys}
            focusStepKey={props.focusStepKey}
            onRetryStep={props.onRetryStep}
            onRerunStep={props.onRerunStep}
            onRestartFromStep={props.onRestartFromStep}
            onViewStepLogs={props.onViewStepLogs}
            onViewStepOutput={props.onViewStepOutput}
            onViewStepDefinition={props.onViewStepDefinition}
            onEditStep={props.onEditStep}
            onDeleteStep={props.onDeleteStep}
            onConnectSteps={props.onConnectSteps}
            onDisconnectSteps={props.onDisconnectSteps}
            selectedStepKeys={props.selectedStepKeys}
            onSelectedStepKeysChange={props.onSelectedStepKeysChange}
            onDeleteSelectedSteps={props.onDeleteSelectedSteps}
          />
        </ReactFlowProvider>
      </div>
    </SectionCardBody>
  )

  const frameContents = (
    <>
      {headerNode}
      {bodyNode}

      {/* Dialogs (moved to wrapper/header) */}
      <StandardConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title={t("workflows.layoutResetAction")}
        description={t("workflows.layoutResetActionDescription")}
        confirmVariant="destructive"
        confirmIcon={<Trash2Icon className="size-4" />}
        onConfirm={async () => {
          confirmReset()
        }}
      />
    </>
  )

  return frame ? (
    <SectionCard
      className={cn("flex min-h-0 flex-col overflow-hidden h-full min-h-[520px] text-card-foreground", props.className)}
    >
      {frameContents}
    </SectionCard>
  ) : (
    <div className={cn("flex min-h-0 flex-col overflow-hidden", props.className)}>{frameContents}</div>
  )
}

"use client"

import * as React from "react"
import ReactFlow, { Background, ReactFlowProvider } from "reactflow"

import { WorkflowGraphCanvasOverlay } from "@/components/graph/workflow-graph-canvas-overlay"
import { SectionCard } from "@/components/common/section-card"
import { cn } from "@/lib/utils"
import type { WorkflowLayoutPresetKey } from "@/lib/client/workflow-layout-store"
import {
  useWorkflowGraphCanvas,
  type WorkflowGraphCanvasUiState,
  type WorkflowGraphStep,
} from "@/components/graph/hooks/use-workflow-graph-canvas"

const BACKGROUND_GAP_PX = 20

export type { WorkflowGraphStep }

export type WorkflowGraphCanvasHandle = {
  /** Current UI state for the wrapper header (does not include selection count). */
  getUiState: () => WorkflowGraphCanvasUiState
  setInteractionMode: (mode: "pan" | "select") => void
  fitReadable: () => void
  zoomIn: () => void
  zoomOut: () => void
  /**
   * Select a layout preset (LR/TB/CUSTOM).
   * Returns:
   * - "ok": applied
   * - "blocked": CUSTOM not allowed
   * - "outdated": CUSTOM exists but was created for a different graph structure (wrapper should show confirm dialog)
   */
  selectLayoutPreset: (preset: WorkflowLayoutPresetKey) => "ok" | "blocked" | "outdated"
  /** Reset/Clear the stored CUSTOM layout and switch back to default preset. */
  resetCustomLayout: () => void
  /** Clear outdated custom (same as reset), close outdated dialog is handled by wrapper. */
  clearOutdatedCustom: () => void
  /** Overwrite CUSTOM with current auto-layout positions, then switch to CUSTOM. */
  rebuildCustomLayout: () => void
}

export function WorkflowGraphCanvasCore(
  props: {
    steps: WorkflowGraphStep[]
    mode?: "view" | "edit"
    className?: string
    frame?: boolean
    workflowId?: string
    /**
     * When true, the canvas will keep auto-fitting the viewport on step/deps changes even if the user
     * has previously moved the viewport. Useful for streaming drafts (agent) where nodes appear over time.
     */
    forceAutoFit?: boolean
    /**
     * Controls whether the layout dropdown (LR/TB/CUSTOM) is shown.
     * Default matches existing behavior: shown in view mode and edit mode.
     */
    showLayoutMenu?: boolean
    /**
     * Controls whether the "CUSTOM" layout option is available.
     * When disabled, the dropdown only offers deterministic auto-layouts (LR/TB).
     *
     * Default matches existing behavior: CUSTOM is available.
     */
    allowCustomLayout?: boolean
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

    onAddStep?: () => void
    onEditStep?: (stepKey: string) => void
    onDeleteStep?: (stepKey: string) => void
    onConnectSteps?: (sourceStepKey: string, targetStepKey: string) => void
    onDisconnectSteps?: (sourceStepKey: string, targetStepKey: string) => void

    selectedStepKeys?: string[]
    onSelectedStepKeysChange?: (stepKeys: string[]) => void
    onDeleteSelectedSteps?: () => void
    /**
     * When provided, the component will NOT render its own overlay controls.
     * Intended for `WorkflowGraphCanvasWrapper` (header outside the canvas).
     */
    disableOverlay?: boolean
    /**
     * Called when non-frame UI state changes (so wrapper header can reflect it).
     * This is not called on every drag frame; it's driven by state changes like preset/mode toggles.
     */
    onUiStateChange?: (s: WorkflowGraphCanvasUiState) => void
  },
  ref: React.ForwardedRef<WorkflowGraphCanvasHandle>,
) {
  const mode = props.mode ?? "view"
  const frame = props.frame ?? true
  const workflowId = props.workflowId ?? null
  const forceAutoFit = props.forceAutoFit ?? false
  const showLayoutMenu = props.showLayoutMenu ?? true
  const allowCustomLayout = props.allowCustomLayout ?? true

  const g = useWorkflowGraphCanvas({
    steps: props.steps,
    mode,
    workflowId,
    forceAutoFit,
    showLayoutMenu,
    allowCustomLayout,
    highlightStepKeys: props.highlightStepKeys,
    focusStepKey: props.focusStepKey,
    stepStatusByKey: props.stepStatusByKey,
    stepDurationMsByKey: props.stepDurationMsByKey,
    onSelectedStepKeysChange: props.onSelectedStepKeysChange,
    onEditStep: props.onEditStep,
    onDeleteStep: props.onDeleteStep,
    onRetryStep: props.onRetryStep,
    onRerunStep: props.onRerunStep,
    onRestartFromStep: props.onRestartFromStep,
    onViewStepLogs: props.onViewStepLogs,
    onViewStepOutput: props.onViewStepOutput,
    onViewStepDefinition: props.onViewStepDefinition,
    onConnectSteps: props.onConnectSteps,
    onDisconnectSteps: props.onDisconnectSteps,
  })

  React.useImperativeHandle(
    ref,
    () => ({
      getUiState: g.getUiState,
      setInteractionMode: g.actions.setInteractionMode,
      fitReadable: g.actions.fitReadable,
      zoomIn: g.actions.zoomIn,
      zoomOut: g.actions.zoomOut,
      selectLayoutPreset: g.actions.selectLayoutPreset,
      resetCustomLayout: g.actions.resetCustomLayout,
      clearOutdatedCustom: g.actions.clearOutdatedCustom,
      rebuildCustomLayout: g.actions.rebuildCustomLayout,
    }),
    [g.actions, g.getUiState],
  )

  React.useEffect(() => {
    props.onUiStateChange?.(g.getUiState())
    // Intentionally exclude `props.onUiStateChange` from deps; caller should pass a stable callback if needed.
  }, [g.getUiState])

  const ui = g.getUiState()

  const canvas = (
    // React Flow needs an explicit height on a parent container.
    <div ref={g.containerRef} className="relative h-full w-full overflow-hidden">
      {!props.disableOverlay ? (
        <WorkflowGraphCanvasOverlay
          showToolbar={ui.showToolbar}
          readonly={ui.readonly}
          workflowId={ui.workflowId}
          interactionMode={ui.interactionMode}
          layoutDirection={ui.layoutDirection}
          layoutPreset={ui.layoutPreset}
          showLayoutDropdown={ui.showLayoutDropdown}
          allowCustom={ui.allowCustom}
          hasOutdatedCustom={ui.hasOutdatedCustom}
          selectedCount={props.selectedStepKeys?.length ?? 0}
          onAddStep={props.onAddStep}
          onDeleteSelectedSteps={props.onDeleteSelectedSteps}
          actions={g.actions}
        />
      ) : null}

      <ReactFlow
        nodes={g.nodes}
        edges={g.edges}
        nodeTypes={g.nodeTypes}
        onNodesChange={g.onNodesChange}
        onEdgesChange={g.onEdgesChange}
        deleteKeyCode={null}
        minZoom={g.minZoom}
        maxZoom={g.maxZoom}
        nodeDragThreshold={6}
        proOptions={g.proOptions}
        onlyRenderVisibleElements
        className={
          ui.showToolbar && ui.interactionMode === "pan"
            ? "cursor-grab"
            : ui.readonly
              ? "cursor-default"
              : "cursor-crosshair"
        }
        connectionLineType={g.connectionLineType}
        connectionLineStyle={g.connectionLineStyle}
        nodesDraggable={g.nodesDraggable}
        nodesConnectable={g.nodesConnectable}
        selectionOnDrag={g.selectionOnDrag}
        selectionKeyCode={g.selectionKeyCode}
        // Use boolean `true` in pan mode so touch devices can drag to pan.
        panOnDrag={g.panOnDrag}
        onMoveStart={g.onMoveStart}
        onConnect={g.onConnect}
        onEdgesDelete={g.onEdgesDelete}
        onSelectionChange={g.onSelectionChange}
        onNodeClick={g.onNodeClick}
        onNodeDragStart={g.onNodeDragStart}
        onNodeDragStop={g.onNodeDragStop}
        onSelectionDragStop={g.onSelectionDragStop}
      >
        <Background gap={BACKGROUND_GAP_PX} />
      </ReactFlow>
    </div>
  )

  return frame ? (
    <SectionCard className={cn("h-full w-full min-h-[520px] bg-card text-card-foreground", props.className)}>
      {canvas}
    </SectionCard>
  ) : (
    <div className={cn("h-full w-full min-h-[520px]", props.className)}>{canvas}</div>
  )
}

export const WorkflowGraphCanvasCoreWithRef = React.forwardRef(WorkflowGraphCanvasCore)

export function WorkflowGraphCanvas(props: {
  steps: WorkflowGraphStep[]
  mode?: "view" | "edit"
  className?: string
  frame?: boolean
  workflowId?: string
  forceAutoFit?: boolean
  showLayoutMenu?: boolean
  allowCustomLayout?: boolean
  stepStatusByKey?: Record<string, string | undefined>
  stepDurationMsByKey?: Record<string, number | null | undefined>
  highlightStepKeys?: string[]
  focusStepKey?: string | null
  onRetryStep?: (stepKey: string) => void
  onRerunStep?: (stepKey: string) => void
  onRestartFromStep?: (stepKey: string) => void

  onAddStep?: () => void
  onEditStep?: (stepKey: string) => void
  onDeleteStep?: (stepKey: string) => void
  onConnectSteps?: (sourceStepKey: string, targetStepKey: string) => void
  onDisconnectSteps?: (sourceStepKey: string, targetStepKey: string) => void

  selectedStepKeys?: string[]
  onSelectedStepKeysChange?: (stepKeys: string[]) => void
  onDeleteSelectedSteps?: () => void
}) {
  return (
    <ReactFlowProvider>
      <WorkflowGraphCanvasCoreWithRef {...props} />
    </ReactFlowProvider>
  )
}

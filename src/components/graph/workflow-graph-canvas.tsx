"use client"

import * as React from "react"
import ReactFlow, { Background, ReactFlowProvider } from "reactflow"

import { WorkflowGraphCanvasOverlay } from "@/components/graph/workflow-graph-canvas-overlay"
import { SectionCard } from "@/components/common/section-card"
import { useI18n } from "@/components/i18n-provider"
import { getCmdOrCtrlLabel } from "@/lib/client/platform"
import { cn } from "@/lib/utils"
import type { WorkflowLayoutPresetKey } from "@/lib/client/workflow-layout-store"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  useWorkflowGraphCanvas,
  type WorkflowGraphCanvasUiState,
  type WorkflowGraphStep,
} from "@/components/graph/hooks/use-workflow-graph-canvas"
import { ArrowLeftRight, ArrowUpDown, Check, Hand, MousePointer2, Pencil, Trash2Icon, X } from "lucide-react"

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
   */
  selectLayoutPreset: (preset: WorkflowLayoutPresetKey) => "ok" | "blocked"
  /** Reset/Clear the stored CUSTOM layout and switch back to default preset. */
  resetCustomLayout: () => void
}

export function WorkflowGraphCanvasCore(
  props: {
    steps: WorkflowGraphStep[]
    mode?: "view" | "edit"
    className?: string
    frame?: boolean
    workflowId?: string
    enableNodeContextMenu?: boolean
    enableEditCanvasContextMenu?: boolean
    onRequestClearCanvas?: () => void
    onRequestLayoutPreset?: (preset: WorkflowLayoutPresetKey) => void
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
  const { t } = useI18n()
  const cmdOrCtrl = React.useMemo(() => getCmdOrCtrlLabel(), [])
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
    enableNodeContextMenu: props.enableNodeContextMenu,
    enableEditCanvasContextMenu: props.enableEditCanvasContextMenu,
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
    }),
    [g.actions, g.getUiState],
  )

  React.useEffect(() => {
    props.onUiStateChange?.(g.getUiState())
    // Intentionally exclude `props.onUiStateChange` from deps; caller should pass a stable callback if needed.
  }, [g.getUiState])

  const ui = g.getUiState()
  const menu = g.contextMenu

  const canEdit = !ui.readonly
  const selectedCount = props.selectedStepKeys?.length ?? 0
  const showDeleteSelectedAction = Boolean(props.onDeleteSelectedSteps) && selectedCount > 0
  const showClearCanvasAction = Boolean(props.onRequestClearCanvas)
  const showDestructiveSection = showDeleteSelectedAction || showClearCanvasAction

  const canvasInner = (
    // React Flow needs an explicit height on a parent container.
    <div
      ref={g.containerRef}
      className="relative h-full w-full overflow-hidden"
      onContextMenuCapture={() => {
        if (!enableContextMenu) return
        if (!menu) g.setContextMenu({ kind: "pane" })
      }}
    >
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
        onEdgeContextMenu={g.onEdgeContextMenu}
        onPaneContextMenu={g.onPaneContextMenu}
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

  const enableContextMenu = canEdit && props.enableEditCanvasContextMenu === true

  const canvas = enableContextMenu ? (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) g.setContextMenu(null)
      }}
    >
      <ContextMenuTrigger asChild>{canvasInner}</ContextMenuTrigger>
      <ContextMenuContent className={menu?.kind === "edge" ? undefined : "min-w-[220px]"}>
        {menu?.kind === "edge" ? (
          <ContextMenuGroup>
            <ContextMenuItem
              onSelect={() => {
                props.onDisconnectSteps?.(menu.source, menu.target)
              }}
            >
              <X className="size-4" />
              {t("workflows.graph.disconnectEdgeAction")}
            </ContextMenuItem>
          </ContextMenuGroup>
        ) : (
          <>
            <ContextMenuGroup>
              <ContextMenuItem
                onSelect={() => {
                  ;(props.onRequestLayoutPreset ?? g.actions.selectLayoutPreset)("LR")
                }}
              >
                <ArrowLeftRight className="size-4" />
                {t("workflows.layoutLeftRight")}
                <ContextMenuShortcut>Q</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  ;(props.onRequestLayoutPreset ?? g.actions.selectLayoutPreset)("TB")
                }}
              >
                <ArrowUpDown className="size-4" />
                {t("workflows.layoutTopBottom")}
                <ContextMenuShortcut>W</ContextMenuShortcut>
              </ContextMenuItem>
              {ui.allowCustom ? (
                <ContextMenuItem
                  onSelect={() => {
                    ;(props.onRequestLayoutPreset ?? g.actions.selectLayoutPreset)("CUSTOM")
                  }}
                >
                  <Pencil className="size-4" />
                  {t("workflows.layoutCustom")}
                  <ContextMenuShortcut>E</ContextMenuShortcut>
                </ContextMenuItem>
              ) : null}
            </ContextMenuGroup>

            <ContextMenuSeparator />

            <ContextMenuGroup>
              <ContextMenuItem
                onSelect={() => {
                  g.actions.setInteractionMode("pan")
                }}
              >
                <Hand className="size-4" />
                {t("common.graphControls.panModeAriaLabel")}
                <ContextMenuShortcut>V</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  g.actions.setInteractionMode("select")
                }}
              >
                <MousePointer2 className="size-4" />
                {t("common.graphControls.selectModeAriaLabel")}
                <ContextMenuShortcut>S</ContextMenuShortcut>
              </ContextMenuItem>
            </ContextMenuGroup>

            <ContextMenuSeparator />

            <ContextMenuItem
              onSelect={() => {
                g.actions.selectAllSteps()
              }}
            >
              <Check className="size-4" />
              {t("workflows.graph.selectAllAction")}
              <ContextMenuShortcut>{cmdOrCtrl}A</ContextMenuShortcut>
            </ContextMenuItem>

            {showDestructiveSection ? (
              <>
                <ContextMenuSeparator />

                {showDeleteSelectedAction ? (
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => {
                      props.onDeleteSelectedSteps?.()
                    }}
                  >
                    <Trash2Icon className="size-4" />
                    {t("workflows.graph.deleteSelectedAction")} ({selectedCount})
                  </ContextMenuItem>
                ) : null}

                {showClearCanvasAction ? (
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => {
                      props.onRequestClearCanvas?.()
                    }}
                  >
                    <Trash2Icon className="size-4" />
                    {t("workflows.graph.clearCanvasAction")}
                  </ContextMenuItem>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  ) : (
    canvasInner
  )

  return frame ? (
    <SectionCard className={cn("h-full w-full min-h-[520px] text-card-foreground", props.className)}>
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

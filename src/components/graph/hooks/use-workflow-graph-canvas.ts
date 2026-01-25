"use client"

import * as React from "react"
import type {
  Edge,
  Node,
  NodeDragHandler,
  NodeMouseHandler,
  OnConnect,
  OnEdgesDelete,
  OnMoveStart,
  OnSelectionChangeFunc,
} from "reactflow"
import { useEdgesState, useNodesState, useReactFlow, ConnectionLineType } from "reactflow"

import {
  deleteWorkflowLayoutPreset,
  getWorkflowLayoutEntry,
  setWorkflowLayoutSelected,
  upsertWorkflowPreset,
  type WorkflowLayoutEntry,
  type WorkflowLayoutPresetKey,
} from "@/lib/client/workflow-layout-store"
import { toCanonicalRunStatus } from "@/lib/shared/run-status"
import { WorkflowGraphStepNode, type WorkflowGraphStepNodeData } from "@/components/graph/workflow-graph-step-node"
import {
  applyStoredPositions,
  dagreLayout,
  nodesToPositions,
  type WorkflowLayoutPoint,
} from "@/components/graph/lib/workflow-graph-layout"

export const REACTFLOW_PRO_OPTIONS = { hideAttribution: true } as const
export const REACTFLOW_CONNECTION_LINE_STYLE = { strokeWidth: 2 } as const
export const REACTFLOW_EDGE_STYLE = { strokeWidth: 2 } as const
export const PAN_MODE_SELECTION_KEYS: string[] = ["Control", "Meta"]
export const PAN_ON_DRAG_MOUSE_BUTTONS: number[] = [1, 2]

export const MIN_READABLE_ZOOM = 0.7
export const MIN_ZOOM = 0.35
export const MAX_ZOOM = 1.8
export const FIT_PADDING = 0.18
export const AUTO_FIT_MAX_NODES = 50
export const DEFAULT_LAYOUT_PRESET: WorkflowLayoutPresetKey = "LR"

export type WorkflowGraphStep = {
  stepKey: string
  name: string
  deps?: string[]
}

export type WorkflowGraphCanvasUiState = {
  interactionMode: "pan" | "select"
  layoutDirection: "LR" | "TB"
  layoutPreset: WorkflowLayoutPresetKey
  showLayoutDropdown: boolean
  allowCustom: boolean
  hasOutdatedCustom: boolean
  showToolbar: boolean
  readonly: boolean
  workflowId: string | null
}

function buildEdges(steps: WorkflowGraphStep[]): Edge[] {
  const byKey = new Set(steps.map((s) => s.stepKey))
  const edges: Edge[] = []
  for (const s of steps) {
    for (const d of s.deps ?? []) {
      if (!byKey.has(d)) continue
      edges.push({
        id: `${d}->${s.stepKey}`,
        source: d,
        target: s.stepKey,
        type: "smoothstep",
        style: REACTFLOW_EDGE_STYLE,
        pathOptions: { borderRadius: 18, offset: 14 },
      })
    }
  }
  return edges
}

export function useWorkflowGraphCanvas(args: {
  steps: WorkflowGraphStep[]
  mode: "view" | "edit"
  workflowId: string | null
  forceAutoFit: boolean
  showLayoutMenu: boolean
  allowCustomLayout: boolean
  highlightStepKeys?: string[]
  focusStepKey?: string | null
  stepStatusByKey?: Record<string, string | undefined>
  stepDurationMsByKey?: Record<string, number | null | undefined>
  onSelectedStepKeysChange?: (stepKeys: string[]) => void
  onEditStep?: (stepKey: string) => void
  onDeleteStep?: (stepKey: string) => void
  onRetryStep?: (stepKey: string) => void
  onRerunStep?: (stepKey: string) => void
  onRestartFromStep?: (stepKey: string) => void
  onViewStepLogs?: (stepKey: string) => void
  onViewStepOutput?: (stepKey: string) => void
  onViewStepDefinition?: (stepKey: string) => void
  onConnectSteps?: (sourceStepKey: string, targetStepKey: string) => void
  onDisconnectSteps?: (sourceStepKey: string, targetStepKey: string) => void
}) {
  const rf = useReactFlow()

  const readonly = args.mode === "view"
  const showToolbar = args.mode === "edit"

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowGraphStepNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const nodeTypes = React.useMemo(() => ({ stepNode: WorkflowGraphStepNode }), [])

  const didInitialLayoutRef = React.useRef(false)
  const lastLayoutSigRef = React.useRef<string>("")
  const didUserMoveViewportRef = React.useRef(false)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  const nodeDragInProgressRef = React.useRef(false)
  const nodeJustDraggedRef = React.useRef(false)
  const clearNodeJustDraggedTimerRef = React.useRef<number | null>(null)

  const pendingEmptyRafRef = React.useRef<number | null>(null)
  const lastEmittedSelectionRef = React.useRef<string[]>([])

  React.useEffect(() => {
    return () => {
      if (pendingEmptyRafRef.current != null) cancelAnimationFrame(pendingEmptyRafRef.current)
      if (clearNodeJustDraggedTimerRef.current != null) window.clearTimeout(clearNodeJustDraggedTimerRef.current)
    }
  }, [])

  const sameSelection = React.useCallback((a: string[], b: string[]) => {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }, [])

  const [interactionMode, setInteractionMode] = React.useState<"pan" | "select">("pan")
  const [layoutDirection, setLayoutDirection] = React.useState<"LR" | "TB">("LR")
  const [layoutPreset, setLayoutPreset] = React.useState<WorkflowLayoutPresetKey>("LR")
  const [layoutEntry, setLayoutEntry] = React.useState<WorkflowLayoutEntry | null>(null)

  const shouldAutoFit = React.useCallback(
    (nodeCount: number) => {
      if (!args.forceAutoFit && didUserMoveViewportRef.current) return false
      if (nodeCount <= 0) return false
      return nodeCount <= AUTO_FIT_MAX_NODES
    },
    [args.forceAutoFit],
  )

  const fitReadable = React.useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rf.fitView({ padding: FIT_PADDING, minZoom: MIN_READABLE_ZOOM })
      })
    })
  }, [rf])

  // One-time: initialize layout preset from localStorage (per workflow).
  React.useEffect(() => {
    if (!args.workflowId) return
    const entry = getWorkflowLayoutEntry(args.workflowId)
    if (!entry) return
    setLayoutEntry(entry)

    // View mode behavior (product rule): if a custom layout exists, default to it; otherwise default to LR.
    if (args.mode === "view") {
      const hasCustom = !!entry?.presets?.CUSTOM?.positions && Object.keys(entry.presets.CUSTOM.positions).length > 0
      if (args.allowCustomLayout && hasCustom) setLayoutPreset("CUSTOM")
      else if (entry.selected === "TB") setLayoutPreset("TB")
      else setLayoutPreset("LR")
      return
    }

    // Edit mode: respect user's last selected preset.
    setLayoutPreset(entry.selected)
    if (entry.selected === "LR" || entry.selected === "TB") setLayoutDirection(entry.selected)
  }, [args.allowCustomLayout, args.mode, args.workflowId])

  const handleSelectionChange = React.useCallback<OnSelectionChangeFunc>(
    (sel) => {
      if (!args.onSelectedStepKeysChange) return
      const next = (sel.nodes ?? []).map((n) => String(n.id))
      // ReactFlow can emit intermediate empty selections during click/drag bursts.
      // Strategy:
      // - Non-empty selection: emit immediately (so upstream UI like "Delete" shows instantly).
      // - Empty selection: emit on next animation frame, and cancel if a non-empty selection arrives first.
      if (next.length > 0) {
        if (pendingEmptyRafRef.current != null) cancelAnimationFrame(pendingEmptyRafRef.current)
        pendingEmptyRafRef.current = null
        if (sameSelection(next, lastEmittedSelectionRef.current)) return
        lastEmittedSelectionRef.current = next
        args.onSelectedStepKeysChange?.(next)
        return
      }

      // Empty selection: defer one frame to avoid flicker (e.g. [id] -> [] -> [id]).
      if (pendingEmptyRafRef.current != null) return
      pendingEmptyRafRef.current = requestAnimationFrame(() => {
        pendingEmptyRafRef.current = null
        const v: string[] = []
        if (sameSelection(v, lastEmittedSelectionRef.current)) return
        lastEmittedSelectionRef.current = v
        args.onSelectedStepKeysChange?.(v)
      })
    },
    [args.onSelectedStepKeysChange, sameSelection],
  )

  const handleNodeClick: NodeMouseHandler = React.useCallback(
    (evt, n) => {
      if (!args.onEditStep) return
      if (nodeDragInProgressRef.current) return
      if (nodeJustDraggedRef.current) return
      if (showToolbar) {
        if (evt.shiftKey || evt.metaKey || evt.ctrlKey) return
      } else {
        if (evt.shiftKey || evt.metaKey || evt.ctrlKey) return
      }
      args.onEditStep(String(n.id))
    },
    [args.onEditStep, showToolbar],
  )

  const layoutSig = React.useMemo(() => {
    // Only include structural fields that impact layout; ignore cosmetic status/duration/highlight.
    return args.steps
      .map((s) => {
        const deps = (s.deps ?? []).slice().sort().join(",")
        return `${s.stepKey}->${deps}`
      })
      .sort()
      .join("|")
  }, [args.steps])

  const liveStoredCustom = React.useMemo(() => {
    if (!args.workflowId) return null
    return getWorkflowLayoutEntry(args.workflowId)?.presets?.CUSTOM ?? null
  }, [args.workflowId, layoutSig])

  const hasOutdatedCustom = React.useMemo(() => {
    const sig = liveStoredCustom?.layoutSig
    if (!sig) return false
    return sig !== layoutSig
  }, [liveStoredCustom?.layoutSig, layoutSig])

  const persistPreset = React.useCallback(
    (
      preset: WorkflowLayoutPresetKey,
      positions: Record<string, WorkflowLayoutPoint>,
      opts?: { selected?: WorkflowLayoutPresetKey },
    ) => {
      if (!args.workflowId) return
      const next = upsertWorkflowPreset(args.workflowId, preset, positions, {
        ...opts,
        layoutSig: preset === "CUSTOM" ? layoutSig : undefined,
      })
      setLayoutEntry(next)
    },
    [args.workflowId, layoutSig],
  )

  const persistSelected = React.useCallback(
    (selected: WorkflowLayoutPresetKey) => {
      if (!args.workflowId) return
      // Product rule: selecting default should NOT delete saved presets; only omit the selected field in storage.
      const next = setWorkflowLayoutSelected(args.workflowId, selected)
      setLayoutEntry(next)
    },
    [args.workflowId],
  )

  const persistCustomNow = React.useCallback(() => {
    if (!args.workflowId) return
    if (args.mode !== "edit") return
    const positions = nodesToPositions(rf.getNodes())
    // Critical: write immediately so we don't re-apply stale CUSTOM from storage on the next syncFromSteps run.
    persistPreset("CUSTOM", positions, { selected: "CUSTOM" })
  }, [args.mode, args.workflowId, persistPreset, rf])

  const syncFromSteps = React.useCallback(
    (opts?: { layout?: boolean; preset?: WorkflowLayoutPresetKey }) => {
      const layout = opts?.layout ?? false
      const preset = opts?.preset ?? layoutPreset

      const nextEdges = buildEdges(args.steps)
      setEdges(nextEdges)
      setNodes((prev) => {
        const prevMap = new Map(prev.map((n) => [n.id, n]))
        const highlight = new Set(args.highlightStepKeys ?? [])
        const failedKeys = new Set(
          Object.entries(args.stepStatusByKey ?? {})
            .filter(([, st]) => toCanonicalRunStatus(String(st ?? "")) === "FAILED")
            .map(([k]) => String(k)),
        )
        const nextNodes: Node<WorkflowGraphStepNodeData>[] = args.steps.map((s) => ({
          id: s.stepKey,
          type: "stepNode",
          position: prevMap.get(s.stepKey)?.position ?? { x: 0, y: 0 },
          selected: prevMap.get(s.stepKey)?.selected,
          data: {
            stepKey: s.stepKey,
            name: s.name,
            depsCount: s.deps?.length ?? 0,
            mode: args.mode,
            status: args.stepStatusByKey?.[s.stepKey],
            durationMs: args.stepDurationMsByKey?.[s.stepKey],
            highlight: highlight.has(s.stepKey),
            otherFailedStepsCount: Math.max(0, failedKeys.size - (failedKeys.has(s.stepKey) ? 1 : 0)),
            onEdit: args.onEditStep,
            onDelete: args.onDeleteStep,
            onRetry: args.onRetryStep,
            onRerunStep: args.onRerunStep,
            onRestartFrom: args.onRestartFromStep,
            onViewStepLogs: args.onViewStepLogs,
            onViewStepOutput: args.onViewStepOutput,
            onViewStepDefinition: args.onViewStepDefinition,
          },
        }))

        // IMPORTANT: LR/TB are always deterministic auto-layouts (dagre).
        // Only CUSTOM uses stored positions. Also, read from localStorage as a source of truth to avoid
        // state timing issues when the user switches presets and we write storage in the same tick.
        const liveEntry = args.workflowId ? getWorkflowLayoutEntry(args.workflowId) : layoutEntry
        const storedCustom = liveEntry?.presets?.CUSTOM?.positions ?? null
        const withStored = preset === "CUSTOM" ? applyStoredPositions(nextNodes, storedCustom) : nextNodes

        if (!layout) return withStored

        // Layout requested:
        // - LR/TB: always run dagre (never apply cached positions).
        // - CUSTOM: use stored where available; missing nodes fall back to dagre to avoid overlap.
        if (preset === "LR" || preset === "TB") {
          return dagreLayout(nextNodes, nextEdges, { direction: preset })
        }

        // CUSTOM
        if (storedCustom && Object.keys(storedCustom).length) {
          const base = dagreLayout(nextNodes, nextEdges, { direction: layoutDirection })
          return applyStoredPositions(base, storedCustom)
        }
        return dagreLayout(nextNodes, nextEdges, { direction: layoutDirection })
      })

      if (layout) {
        // ReactFlow updates its internal node bounds asynchronously; a single RAF can be too early
        // during streaming updates (agent drafts), resulting in a viewport that only includes 1 node.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!shouldAutoFit(args.steps.length)) return
            rf.fitView({ padding: FIT_PADDING, minZoom: MIN_READABLE_ZOOM })
          })
        })
      }
    },
    [
      args.steps,
      args.workflowId,
      args.highlightStepKeys,
      args.mode,
      args.onDeleteStep,
      args.onEditStep,
      args.onRestartFromStep,
      args.onRerunStep,
      args.onRetryStep,
      args.stepDurationMsByKey,
      args.stepStatusByKey,
      layoutDirection,
      layoutEntry,
      layoutPreset,
      rf,
      setEdges,
      setNodes,
      shouldAutoFit,
    ],
  )

  const relayoutAndFocus = React.useCallback(
    (nextPreset?: WorkflowLayoutPresetKey) => {
      const preset = nextPreset ?? layoutPreset
      setLayoutPreset(preset)
      if (preset === "LR" || preset === "TB") setLayoutDirection(preset)

      // This is an explicit user action; always bring the graph into view at a readable zoom.
      requestAnimationFrame(() => {
        syncFromSteps({ layout: true, preset })
        fitReadable()
      })
    },
    [fitReadable, layoutPreset, syncFromSteps],
  )

  // Initial build + relayout (once, when steps arrive)
  React.useEffect(() => {
    if (didInitialLayoutRef.current) return
    if (!args.steps.length) return
    didInitialLayoutRef.current = true
    lastLayoutSigRef.current = layoutSig
    syncFromSteps({ layout: true, preset: layoutPreset })
  }, [args.steps.length, layoutSig, layoutPreset, syncFromSteps])

  React.useEffect(() => {
    if (!didInitialLayoutRef.current) return
    syncFromSteps({ layout: false })
  }, [args.steps, syncFromSteps])

  // In view mode, when the graph structure changes (steps/deps), re-run dagre layout.
  // This prevents "all new nodes at (0,0)" overlap during streaming updates (e.g. agent proposal drafts).
  React.useEffect(() => {
    if (!didInitialLayoutRef.current) return
    if (args.mode !== "view") return
    if (!args.steps.length) return
    if (layoutSig === lastLayoutSigRef.current) return
    lastLayoutSigRef.current = layoutSig
    syncFromSteps({ layout: true, preset: layoutPreset })
  }, [args.mode, args.steps.length, layoutSig, layoutPreset, syncFromSteps])

  // Extra safety: in view mode we should never end up with a "partial viewport" while steps exist.
  // If nodes are present but not all of them are mounted/visible due to timing, force a re-fit.
  React.useEffect(() => {
    if (!didInitialLayoutRef.current) return
    if (args.mode !== "view") return
    if (args.steps.length <= 1) return
    if (nodes.length !== args.steps.length) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!shouldAutoFit(args.steps.length)) return
        rf.fitView({ padding: FIT_PADDING, minZoom: MIN_READABLE_ZOOM })
      })
    })
  }, [args.mode, args.steps.length, nodes.length, rf, shouldAutoFit])

  // When the container size changes (responsive layout / panel resize), re-fit the viewport.
  React.useEffect(() => {
    if (typeof ResizeObserver === "undefined") return
    const el = containerRef.current
    if (!el) return
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (!didInitialLayoutRef.current) return
      if (!nodes.length) return
      if (!shouldAutoFit(nodes.length)) return
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        rf.fitView({ padding: FIT_PADDING, minZoom: MIN_READABLE_ZOOM })
      })
    })
    ro.observe(el)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [nodes.length, rf, shouldAutoFit])

  // Optionally focus a specific step node (useful for run detail "follow along").
  React.useEffect(() => {
    const key = args.focusStepKey
    if (!key) return
    if (!didInitialLayoutRef.current) return
    const n = rf.getNode(key)
    if (!n) return
    requestAnimationFrame(() => {
      rf.fitView({ nodes: [n], padding: 0.4, duration: 320 })
    })
  }, [args.focusStepKey, rf])

  const showLayoutDropdown = args.showLayoutMenu && (args.mode === "view" || showToolbar)

  const getUiState = React.useCallback((): WorkflowGraphCanvasUiState => {
    return {
      interactionMode,
      layoutDirection,
      layoutPreset,
      showLayoutDropdown,
      allowCustom: args.allowCustomLayout,
      hasOutdatedCustom,
      showToolbar,
      readonly,
      workflowId: args.workflowId,
    }
  }, [
    args.allowCustomLayout,
    args.workflowId,
    hasOutdatedCustom,
    interactionMode,
    layoutDirection,
    layoutPreset,
    readonly,
    showLayoutDropdown,
    showToolbar,
  ])

  const handleMoveStart: OnMoveStart = React.useCallback((evt) => {
    if (!didInitialLayoutRef.current) return
    if (evt) didUserMoveViewportRef.current = true
  }, [])

  const handleConnect: OnConnect = React.useCallback(
    (c) => {
      if (readonly) return
      if (!c.source || !c.target) return
      args.onConnectSteps?.(String(c.source), String(c.target))
    },
    [args.onConnectSteps, readonly],
  )

  const handleEdgesDelete: OnEdgesDelete = React.useCallback(
    (deleted) => {
      if (readonly) return
      for (const e of deleted ?? []) {
        if (!e.source || !e.target) continue
        args.onDisconnectSteps?.(String(e.source), String(e.target))
      }
    },
    [args.onDisconnectSteps, readonly],
  )

  const handleNodeDragStart: NodeDragHandler = React.useCallback(() => {
    nodeDragInProgressRef.current = true
    // Any drag counts as user viewport interaction for the purposes of auto-fit.
    didUserMoveViewportRef.current = true

    nodeJustDraggedRef.current = false
    if (clearNodeJustDraggedTimerRef.current != null) {
      window.clearTimeout(clearNodeJustDraggedTimerRef.current)
      clearNodeJustDraggedTimerRef.current = null
    }
  }, [])

  const handleNodeDragStop = React.useCallback(() => {
    nodeDragInProgressRef.current = false
    nodeJustDraggedRef.current = true
    if (clearNodeJustDraggedTimerRef.current != null) window.clearTimeout(clearNodeJustDraggedTimerRef.current)
    clearNodeJustDraggedTimerRef.current = window.setTimeout(() => {
      nodeJustDraggedRef.current = false
      clearNodeJustDraggedTimerRef.current = null
    }, 0)

    if (!args.workflowId) return
    if (args.mode !== "edit") return
    // Manual node move => becomes a custom layout.
    if (layoutPreset !== "CUSTOM") setLayoutPreset("CUSTOM")
    persistCustomNow()
  }, [args.mode, args.workflowId, layoutPreset, persistCustomNow])

  const handleSelectionDragStop = React.useCallback(() => {
    nodeDragInProgressRef.current = false
    nodeJustDraggedRef.current = true
    if (clearNodeJustDraggedTimerRef.current != null) window.clearTimeout(clearNodeJustDraggedTimerRef.current)
    clearNodeJustDraggedTimerRef.current = window.setTimeout(() => {
      nodeJustDraggedRef.current = false
      clearNodeJustDraggedTimerRef.current = null
    }, 0)

    if (!args.workflowId) return
    if (args.mode !== "edit") return
    if (layoutPreset !== "CUSTOM") setLayoutPreset("CUSTOM")
    persistCustomNow()
  }, [args.mode, args.workflowId, layoutPreset, persistCustomNow])

  const selectLayoutPreset = React.useCallback(
    (v: WorkflowLayoutPresetKey): "ok" | "blocked" | "outdated" => {
      if (v === "CUSTOM" && !args.allowCustomLayout) return "blocked"
      if (v === "CUSTOM" && hasOutdatedCustom) return "outdated"

      // Persist selection immediately (default selection is omitted from storage, presets are kept).
      persistSelected(v)
      if (v === "CUSTOM") {
        // If no custom preset exists yet, create one from current positions.
        const existing = layoutEntry?.presets?.CUSTOM?.positions
        const has = existing && Object.keys(existing).length
        if (!has) {
          persistPreset("CUSTOM", nodesToPositions(rf.getNodes()), { selected: "CUSTOM" })
        }
      }
      relayoutAndFocus(v)
      return "ok"
    },
    [
      args.allowCustomLayout,
      hasOutdatedCustom,
      layoutEntry?.presets?.CUSTOM?.positions,
      persistPreset,
      persistSelected,
      relayoutAndFocus,
      rf,
    ],
  )

  const resetCustomLayout = React.useCallback(() => {
    if (!args.workflowId) return
    const next = deleteWorkflowLayoutPreset(args.workflowId, "CUSTOM")
    setLayoutEntry(next)
    // After reset, always return to default LR (UI + dropdown state).
    persistSelected(DEFAULT_LAYOUT_PRESET)
    setLayoutPreset(DEFAULT_LAYOUT_PRESET)
    setLayoutDirection("LR")
    relayoutAndFocus(DEFAULT_LAYOUT_PRESET)
  }, [args.workflowId, persistSelected, relayoutAndFocus])

  const rebuildCustomLayout = React.useCallback(() => {
    // Overwrite CUSTOM with the current auto-layout positions, then switch to CUSTOM.
    persistPreset("CUSTOM", nodesToPositions(rf.getNodes()), { selected: "CUSTOM" })
    persistSelected("CUSTOM")
    setLayoutPreset("CUSTOM")
    relayoutAndFocus("CUSTOM")
  }, [persistPreset, persistSelected, relayoutAndFocus, rf])

  return {
    // Render-time
    containerRef,
    nodes,
    edges,
    nodeTypes,
    onNodesChange,
    onEdgesChange,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    proOptions: REACTFLOW_PRO_OPTIONS,
    connectionLineType: ConnectionLineType.SmoothStep,
    connectionLineStyle: REACTFLOW_CONNECTION_LINE_STYLE,
    nodesDraggable: !readonly,
    nodesConnectable: !readonly,
    selectionOnDrag: showToolbar && interactionMode === "select",
    selectionKeyCode: showToolbar && interactionMode === "pan" ? PAN_MODE_SELECTION_KEYS : undefined,
    panOnDrag: showToolbar ? (interactionMode === "pan" ? true : PAN_ON_DRAG_MOUSE_BUTTONS) : true,
    onMoveStart: handleMoveStart,
    onConnect: handleConnect,
    onEdgesDelete: handleEdgesDelete,
    onSelectionChange: handleSelectionChange,
    onNodeClick: handleNodeClick,
    onNodeDragStart: handleNodeDragStart,
    onNodeDragStop: handleNodeDragStop,
    onSelectionDragStop: handleSelectionDragStop,
    readonly,
    showToolbar,
    interactionMode,
    layoutDirection,
    layoutPreset,

    // Wrapper + overlay integration
    getUiState,
    actions: {
      setInteractionMode,
      fitReadable,
      zoomIn: () => rf.zoomIn(),
      zoomOut: () => rf.zoomOut(),
      selectLayoutPreset,
      resetCustomLayout,
      clearOutdatedCustom: resetCustomLayout,
      rebuildCustomLayout,
    },
  }
}

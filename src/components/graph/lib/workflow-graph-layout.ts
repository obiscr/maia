"use client"

import dagre from "dagre"
import type { Edge, Node } from "reactflow"

export const STEP_NODE_WIDTH_PX = 260
export const STEP_NODE_HEIGHT_PX = 86

export type WorkflowLayoutPoint = { x: number; y: number }

export function nodesToPositions<TData>(nodes: Array<Node<TData>>): Record<string, WorkflowLayoutPoint> {
  const out: Record<string, WorkflowLayoutPoint> = {}
  for (const n of nodes) {
    out[String(n.id)] = { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 }
  }
  return out
}

export function applyStoredPositions<TNode extends Node<unknown>>(
  nodes: TNode[],
  stored: Record<string, WorkflowLayoutPoint> | undefined | null,
): TNode[] {
  if (!stored) return nodes
  return nodes.map((n) => {
    const p = stored[String(n.id)]
    if (!p) return n
    return { ...n, position: { x: p.x, y: p.y } }
  })
}

export function dagreLayout<TData>(
  nodes: Node<TData>[],
  edges: Edge[],
  opts?: { direction?: "LR" | "TB"; nodeSepTB?: number; nodeSepLR?: number; rankSepTB?: number; rankSepLR?: number },
): Node<TData>[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))

  const direction = opts?.direction ?? "LR"
  g.setGraph({
    rankdir: direction,
    nodesep: direction === "TB" ? (opts?.nodeSepTB ?? 90) : (opts?.nodeSepLR ?? 120),
    ranksep: direction === "TB" ? (opts?.rankSepTB ?? 130) : (opts?.rankSepLR ?? 160),
    marginx: 20,
    marginy: 20,
  })

  for (const n of nodes) {
    g.setNode(n.id, { width: STEP_NODE_WIDTH_PX, height: STEP_NODE_HEIGHT_PX })
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  return nodes.map((n) => {
    const p = g.node(n.id) as { x: number; y: number } | undefined
    if (!p) return n
    return { ...n, position: { x: p.x - STEP_NODE_WIDTH_PX / 2, y: p.y - STEP_NODE_HEIGHT_PX / 2 } }
  })
}

export type WorkflowGraphStepLike = {
  stepKey: string
  deps?: string[] | null | undefined
}

export type WorkflowGraphValidationError =
  | { code: "DUP_STEP_KEY"; stepKey: string }
  | { code: "UNKNOWN_DEP"; stepKey: string; dep: string }
  | { code: "SELF_DEP"; stepKey: string }
  | { code: "CYCLE"; cycle: string[] }

export type WorkflowGraphApiErrorCode =
  | "WORKFLOW_GRAPH_DUP_STEP_KEY"
  | "WORKFLOW_GRAPH_UNKNOWN_DEP"
  | "WORKFLOW_GRAPH_SELF_DEP"
  | "WORKFLOW_GRAPH_HAS_CYCLE"

export type WorkflowGraphApiError = {
  code: WorkflowGraphApiErrorCode
  meta: Record<string, unknown>
}

export function workflowGraphValidationErrorToApiError(err: WorkflowGraphValidationError): WorkflowGraphApiError {
  if (err.code === "DUP_STEP_KEY") return { code: "WORKFLOW_GRAPH_DUP_STEP_KEY", meta: { stepKey: err.stepKey } }
  if (err.code === "UNKNOWN_DEP")
    return { code: "WORKFLOW_GRAPH_UNKNOWN_DEP", meta: { stepKey: err.stepKey, dep: err.dep } }
  if (err.code === "SELF_DEP") return { code: "WORKFLOW_GRAPH_SELF_DEP", meta: { stepKey: err.stepKey } }
  return { code: "WORKFLOW_GRAPH_HAS_CYCLE", meta: { cycle: err.cycle } }
}

export type WorkflowGraphSnapshotInvalidReason = WorkflowGraphValidationError["code"]

export function workflowGraphValidationErrorToInvalidSnapshotMeta(
  err: WorkflowGraphValidationError,
): Record<string, unknown> {
  if (err.code === "DUP_STEP_KEY")
    return { reason: "DUP_STEP_KEY" satisfies WorkflowGraphSnapshotInvalidReason, stepKey: err.stepKey }
  if (err.code === "UNKNOWN_DEP")
    return { reason: "UNKNOWN_DEP" satisfies WorkflowGraphSnapshotInvalidReason, stepKey: err.stepKey, dep: err.dep }
  if (err.code === "SELF_DEP")
    return { reason: "SELF_DEP" satisfies WorkflowGraphSnapshotInvalidReason, stepKey: err.stepKey }
  return { reason: "CYCLE" satisfies WorkflowGraphSnapshotInvalidReason, cycle: err.cycle }
}

export type WorkflowGraphI18nErrorKey =
  | "errors.WORKFLOW_GRAPH_DUP_STEP_KEY"
  | "errors.WORKFLOW_GRAPH_UNKNOWN_DEP"
  | "errors.WORKFLOW_GRAPH_SELF_DEP"
  | "errors.WORKFLOW_GRAPH_HAS_CYCLE"

export function workflowGraphValidationErrorToI18nKey(err: WorkflowGraphValidationError): WorkflowGraphI18nErrorKey {
  if (err.code === "DUP_STEP_KEY") return "errors.WORKFLOW_GRAPH_DUP_STEP_KEY"
  if (err.code === "UNKNOWN_DEP") return "errors.WORKFLOW_GRAPH_UNKNOWN_DEP"
  if (err.code === "SELF_DEP") return "errors.WORKFLOW_GRAPH_SELF_DEP"
  return "errors.WORKFLOW_GRAPH_HAS_CYCLE"
}

function uniqStrings(arr: string[]) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of arr) {
    const s = String(v || "").trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/**
 * Industry-standard DAG validation for workflow steps.
 *
 * Guarantees:
 * - stepKey uniqueness
 * - deps reference existing stepKeys
 * - no self-deps
 * - no cycles
 *
 * Notes:
 * - deps are treated as edges stepKey -> dep (i.e. step depends on dep).
 * - returns a representative cycle path when a cycle exists.
 */
export function validateWorkflowGraph(
  steps: WorkflowGraphStepLike[],
): { ok: true } | { ok: false; error: WorkflowGraphValidationError } {
  const keys: string[] = steps.map((s) => String(s.stepKey || "").trim())

  const keySet = new Set<string>()
  for (const k of keys) {
    if (keySet.has(k)) return { ok: false, error: { code: "DUP_STEP_KEY", stepKey: k } }
    keySet.add(k)
  }

  const depsByKey = new Map<string, string[]>()
  for (const s of steps) {
    const k = String(s.stepKey || "").trim()
    const deps = uniqStrings(Array.isArray(s.deps) ? s.deps : [])
    for (const d of deps) {
      if (d === k) return { ok: false, error: { code: "SELF_DEP", stepKey: k } }
      if (!keySet.has(d)) return { ok: false, error: { code: "UNKNOWN_DEP", stepKey: k, dep: d } }
    }
    depsByKey.set(k, deps)
  }

  // Cycle detection (DFS with 3-color marking).
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const idxInStack = new Map<string, number>()

  const dfs = (k: string): string[] | null => {
    state.set(k, 1)
    idxInStack.set(k, stack.length)
    stack.push(k)

    for (const d of depsByKey.get(k) ?? []) {
      const st = state.get(d) ?? 0
      if (st === 0) {
        const cyc = dfs(d)
        if (cyc) return cyc
      } else if (st === 1) {
        const start = idxInStack.get(d)
        const seg = typeof start === "number" ? stack.slice(start) : [d]
        return [...seg, d]
      }
    }

    stack.pop()
    idxInStack.delete(k)
    state.set(k, 2)
    return null
  }

  for (const k of keys) {
    if ((state.get(k) ?? 0) !== 0) continue
    const cyc = dfs(k)
    if (cyc) return { ok: false, error: { code: "CYCLE", cycle: cyc } }
  }

  return { ok: true }
}

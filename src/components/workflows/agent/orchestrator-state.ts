import type { UIMessage } from "ai"

import { isRecord } from "@/lib/shared/lang/is-record"
import { isToolUIPart, getToolName } from "ai"
import { findToolPartByName } from "@/lib/shared/agent/tool-parts"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStep = {
  stepKey: string
  name: string
  description?: string | null
  scriptEsm: string
  timeoutMs?: number
  deps: string[]
}

export type WorkflowForPanel = {
  id: string
  name: string
  description: string | null
  dependencies?: string
  inputSpec?: string
  steps: WorkflowStep[]
}

export type ProposalState = { ok?: boolean; draft?: unknown; warnings?: string[]; toolCallId?: string } | null

export type OrchestratorPlanStep = { stepKey?: string; name: string; description: string }
export type OrchestratorPlan = { title: string | null; steps: OrchestratorPlanStep[] }

export type PlanPreviewStep = {
  stepKey: string
  name: string
  deps: string[]
}

// ---------------------------------------------------------------------------
// Extractors — derive orchestrator state from AI SDK message parts
// ---------------------------------------------------------------------------

function readOrchestratorPlanInput(input: unknown): OrchestratorPlan | null {
  const r = isRecord(input) ? (input as Record<string, unknown>) : null
  if (!r) return null

  const stepsRaw = r.steps
  if (!Array.isArray(stepsRaw)) return null

  const steps: OrchestratorPlanStep[] = []
  for (const s of stepsRaw) {
    const step = isRecord(s) ? (s as Record<string, unknown>) : null
    const name = typeof step?.name === "string" ? step.name.trim() : ""
    const description = typeof step?.description === "string" ? step.description.trim() : ""
    if (!name) return null
    const stepKey = typeof step?.stepKey === "string" ? step.stepKey.trim() : undefined
    steps.push({ ...(stepKey ? { stepKey } : {}), name, description })
  }

  return {
    title: typeof r.title === "string" ? r.title : null,
    steps,
  }
}

export function extractPlanFromMessages(messages: UIMessage[]): OrchestratorPlan | null {
  // First, look for create_plan (Agent direct mode).
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    for (const part of msg.parts) {
      if (
        isToolUIPart(part) &&
        getToolName(part) === "create_plan" &&
        (part.state === "output-available" || part.state === "input-available")
      ) {
        const plan = readOrchestratorPlanInput(part.input)
        if (plan) return plan
      }
    }
  }

  // Fallback: look for plan_ready (Plan → Agent handoff mode).
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    for (const part of msg.parts) {
      if (
        isToolUIPart(part) &&
        getToolName(part) === "plan_ready" &&
        (part.state === "output-available" || part.state === "input-available")
      ) {
        const input = isRecord(part.input) ? (part.input as Record<string, unknown>) : null
        if (!input) continue
        const rawSteps = Array.isArray(input.steps) ? input.steps : []
        if (rawSteps.length === 0) continue
        const steps: OrchestratorPlanStep[] = rawSteps.map((s: unknown) => {
          if (typeof s === "string") return { name: s, description: "" }
          if (isRecord(s)) {
            const st = s as Record<string, unknown>
            const name = typeof st.name === "string" ? st.name : typeof st.stepKey === "string" ? st.stepKey : String(s)
            return { name, description: "" }
          }
          return { name: String(s), description: "" }
        })
        return { title: typeof input.title === "string" ? input.title : null, steps }
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Plan preview steps — for canvas rendering during Plan/Agent modes
// ---------------------------------------------------------------------------

function readStructuredSteps(rawSteps: unknown[]): PlanPreviewStep[] | null {
  const result: PlanPreviewStep[] = []
  for (const s of rawSteps) {
    if (!isRecord(s)) return null
    const st = s as Record<string, unknown>
    const stepKey = typeof st.stepKey === "string" ? st.stepKey.trim() : ""
    const name = typeof st.name === "string" ? st.name.trim() : ""
    if (!stepKey || !name) return null
    const deps = Array.isArray(st.deps) ? st.deps.map(String) : []
    result.push({ stepKey, name, deps })
  }
  return result.length > 0 ? result : null
}

export function extractPlanPreviewSteps(messages: UIMessage[]): PlanPreviewStep[] | null {
  // Single reverse scan: the most recent message wins.
  // Within the same message, priority is: plan_ready > preview_steps > create_plan.
  const TOOL_NAMES = ["plan_ready", "preview_steps", "create_plan"] as const

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!

    let bestInMsg: PlanPreviewStep[] | null = null
    let bestPriority: number = TOOL_NAMES.length

    for (const part of msg.parts) {
      if (!isToolUIPart(part) || (part.state !== "output-available" && part.state !== "input-available")) continue

      const toolName = getToolName(part)
      const priority = TOOL_NAMES.indexOf(toolName as (typeof TOOL_NAMES)[number])
      if (priority === -1 || priority >= bestPriority) continue

      const input = isRecord(part.input) ? (part.input as Record<string, unknown>) : null
      if (!input) continue
      const rawSteps = Array.isArray(input.steps) ? input.steps : []
      const structured = readStructuredSteps(rawSteps)
      if (!structured) continue

      bestInMsg = structured
      bestPriority = priority
      if (priority === 0) break
    }

    if (bestInMsg) return bestInMsg
  }

  return null
}

export function extractDraftStepsFromMessages(messages: UIMessage[]): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  const idxByKey = new Map<string, number>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (
        isToolUIPart(part) &&
        getToolName(part) === "define_step" &&
        (part.state === "output-available" || part.state === "input-available")
      ) {
        const inp = isRecord(part.input) ? part.input : null
        const step = isRecord(inp?.step) ? (inp.step as Record<string, unknown>) : null
        if (step) {
          const stepKey = typeof step.stepKey === "string" ? step.stepKey : ""
          if (!stepKey) continue
          const next: WorkflowStep = {
            stepKey,
            name: typeof step.name === "string" ? step.name : "",
            description: typeof step.description === "string" ? step.description : null,
            scriptEsm: typeof step.scriptEsm === "string" ? step.scriptEsm : "",
            timeoutMs: typeof step.timeoutMs === "number" ? step.timeoutMs : undefined,
            deps: Array.isArray(step.deps) ? step.deps.map(String) : [],
          }
          const existingIdx = idxByKey.get(stepKey)
          if (existingIdx != null) {
            steps[existingIdx] = next
          } else {
            idxByKey.set(stepKey, steps.length)
            steps.push(next)
          }
        }
      }
    }
  }
  return steps
}

export function extractProposalFromMessages(messages: UIMessage[]): ProposalState {
  let baseDraft: Record<string, unknown> | null = null
  let warnings: string[] = []
  let toolCallId: string | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    for (const part of msg.parts) {
      if (isToolUIPart(part) && getToolName(part) === "validate_draft" && part.state === "output-available") {
        const r = part.output
        if (isRecord(r) && r.ok === true && isRecord(r.draft)) {
          baseDraft = r.draft as Record<string, unknown>
          warnings = Array.isArray(r.warnings) ? (r.warnings as string[]) : []
          toolCallId = part.toolCallId
          break
        }
      }
    }
    if (baseDraft) break
  }

  if (!baseDraft) return null

  let inputSpec: string | undefined
  let outputsSpec: string | undefined

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (!isToolUIPart(part) || part.state !== "output-available") continue
      const name = getToolName(part)
      const out = isRecord(part.output) ? (part.output as Record<string, unknown>) : null
      if (!out || out.ok !== true) continue
      if (name === "generate_input_spec" && typeof out.inputSpec === "string") {
        inputSpec = out.inputSpec
      }
      if (name === "generate_output_spec" && typeof out.outputsSpec === "string") {
        outputsSpec = out.outputsSpec
      }
    }
  }

  const mergedDraft = {
    ...baseDraft,
    ...(inputSpec ? { inputSpec } : {}),
    ...(outputsSpec ? { outputsSpec } : {}),
  }

  return { ok: true, draft: mergedDraft, warnings, toolCallId }
}

export function extractSavedWorkflowIdFromMessages(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    for (const part of msg.parts) {
      if (!isToolUIPart(part) || part.state !== "output-available") continue
      const toolName = getToolName(part)
      if (toolName !== "create_workflow" && toolName !== "update_workflow") continue
      const out = part.output
      if (!isRecord(out) || out.ok !== true) continue
      const wid = out.workflowId
      if (typeof wid === "string" && wid.trim()) return wid.trim()
      const wf = isRecord(out.workflow) ? (out.workflow as Record<string, unknown>) : null
      const pid = wf && (typeof wf.publicId === "string" ? wf.publicId : typeof wf.id === "string" ? wf.id : "")
      if (typeof pid === "string" && pid.trim()) return pid.trim()
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Stage status — derive from tool part states
// ---------------------------------------------------------------------------

export type StageStatusMap = {
  plan: "todo" | "in_progress" | "done"
  draft: "todo" | "in_progress" | "done"
  validate: "todo" | "in_progress" | "done"
  isOrchestrator: boolean
}

export function deriveStageStatus(messages: UIMessage[], chatPending: boolean): StageStatusMap {
  const allParts = messages.flatMap((m) => m.parts)

  const hasPlanOutput = !!findToolPartByName(allParts, "create_plan", "output-available")
  const hasPlanStreaming = !!findToolPartByName(allParts, "create_plan", "input-streaming", "input-available")

  // plan_ready from Plan mode also counts as a completed plan.
  const hasPlanReadyOutput = !!findToolPartByName(allParts, "plan_ready", "output-available")

  const hasDraftOutput = !!findToolPartByName(allParts, "define_step", "output-available")
  const hasDraftStreaming = !!findToolPartByName(allParts, "define_step", "input-streaming", "input-available")

  const hasValidateOk = allParts.some((p) => {
    if (!isToolUIPart(p)) return false
    if (getToolName(p) !== "validate_draft" || p.state !== "output-available") return false
    const out = isRecord(p.output) ? (p.output as Record<string, unknown>) : null
    return out?.ok === true
  })
  const hasValidateOutput = !!findToolPartByName(allParts, "validate_draft", "output-available")
  const hasValidateStreaming = !!findToolPartByName(allParts, "validate_draft", "input-streaming", "input-available")

  const hasPlanDone = hasPlanOutput || hasPlanReadyOutput

  const hasAnyOrchestratorTool =
    hasPlanDone || hasPlanStreaming || hasDraftOutput || hasDraftStreaming || hasValidateOutput || hasValidateStreaming

  type S = "todo" | "in_progress" | "done"
  const planStatus: S = hasPlanDone
    ? "done"
    : hasPlanStreaming
      ? "in_progress"
      : chatPending && hasAnyOrchestratorTool && !hasDraftOutput
        ? "in_progress"
        : "todo"
  const draftStatus: S =
    hasValidateOk || hasValidateOutput
      ? "done"
      : hasDraftOutput
        ? hasDraftStreaming || chatPending
          ? "in_progress"
          : "done"
        : hasPlanDone && (hasDraftStreaming || chatPending)
          ? "in_progress"
          : "todo"
  const validateStatus: S = hasValidateOk
    ? "done"
    : hasValidateStreaming || (hasValidateOutput && chatPending)
      ? "in_progress"
      : "todo"

  return { plan: planStatus, draft: draftStatus, validate: validateStatus, isOrchestrator: hasAnyOrchestratorTool }
}

// ---------------------------------------------------------------------------
// Proposal / draft helpers
// ---------------------------------------------------------------------------

export function readDraftSteps(p: ProposalState): WorkflowStep[] | null {
  const draft = p?.draft
  if (!isRecord(draft)) return null
  const steps = (draft as Record<string, unknown>).steps
  if (!Array.isArray(steps)) return null
  return steps as WorkflowStep[]
}

export function readDraftObject(p: ProposalState): Record<string, unknown> | null {
  return isRecord(p?.draft) ? (p?.draft as Record<string, unknown>) : null
}

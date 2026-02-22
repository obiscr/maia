import "server-only"

import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

const ORCHESTRATOR_TOOL_NAMES = new Set([
  "get_workflow",
  "set_plan",
  "draft_step",
  "generate_input_spec",
  "generate_output_spec",
  "finalize_draft",
  "create_workflow_draft",
  "update_workflow_draft",
])

/**
 * Tracks the agent mode and orchestrator pipeline phase during a single
 * streamText run.
 *
 * Mode flow:  undecided → orchestrator | general
 *   (once locked, mode never changes for the rest of the chat)
 *
 * Phase flow (orchestrator only):
 *   plan → draft → specs → finalize → save → (text confirmation) → terminal
 *
 * Finalize may fail; when it does the model is allowed to go back to draft_step
 * to repair individual steps, then retry finalize_draft.
 *
 * Used by the chat route's `prepareStep` to gate tool availability and
 * by `stopWhen` to terminate generation after the workflow is saved.
 */
export class OrchestratorPhaseTracker {
  private readonly isEditing: boolean
  private readonly registryToolNames: string[]
  private mode: "undecided" | "orchestrator" | "general"
  private phase: "plan" | "draft" = "plan"
  private planStepsCount = 0
  private draftedCount = 0
  private inputSpecDone = false
  private outputsSpecDone = false
  private finalizeDone = false
  private finalizeFailed = false
  private saveDone = false

  /** True once the model should stop generating. */
  terminal = false

  constructor(opts?: {
    isEditing?: boolean
    initialMode?: "undecided" | "orchestrator" | "general"
    registryToolNames?: string[]
  }) {
    this.isEditing = Boolean(opts?.isEditing)
    this.registryToolNames = opts?.registryToolNames ?? []
    this.mode = opts?.initialMode ?? (this.isEditing ? "orchestrator" : "undecided")
  }

  get currentMode() {
    return this.mode
  }

  get detectedProfileId(): "workflow.orchestrator" | "general.tools" | null {
    if (this.mode === "orchestrator") return "workflow.orchestrator"
    if (this.mode === "general") return "general.tools"
    return null
  }

  onPlanSet(stepsCount: number) {
    this.mode = "orchestrator"
    if (stepsCount !== this.planStepsCount) this.draftedCount = 0
    this.planStepsCount = stepsCount
    this.phase = "draft"
  }

  onStepDrafted() {
    this.draftedCount++
  }

  /**
   * Process tool results from `onStepFinish`.
   * Updates internal mode + phase based on which tools completed.
   */
  processToolResults(toolResults: ReadonlyArray<{ toolName: string; output: unknown }>) {
    for (const tr of toolResults) {
      const out = isPlainObject(tr.output) ? (tr.output as Record<string, unknown>) : null

      if (this.mode === "undecided") {
        if (ORCHESTRATOR_TOOL_NAMES.has(tr.toolName)) {
          this.mode = "orchestrator"
        } else {
          this.mode = "general"
        }
      }

      switch (tr.toolName) {
        case "generate_input_spec":
          this.inputSpecDone = true
          break
        case "generate_output_spec":
          this.outputsSpecDone = true
          break
        case "finalize_draft":
          if (out?.ok === true) {
            this.finalizeDone = true
            this.finalizeFailed = false
            this.saveDone = false
          } else {
            this.finalizeFailed = true
          }
          break
        case "draft_step":
          if (this.finalizeFailed) {
            this.finalizeFailed = false
          }
          break
        case "create_workflow_draft":
        case "update_workflow_draft":
          if (out?.ok === true) {
            this.saveDone = true
            this.terminal = true
          }
          break
      }
    }

    // After save, allow one text-only step for the confirmation message, then stop.
    if (!toolResults.length && this.saveDone) {
      this.terminal = true
    }
  }

  /**
   * Returns the tool names available for the current mode/phase, or
   * `undefined` when all tools should be available (undecided mode).
   * Called by `prepareStep` to restrict which tools the model can invoke.
   */
  activeTools(): string[] | undefined {
    if (this.mode === "undecided") return undefined

    if (this.mode === "general") return this.registryToolNames

    return [
      "get_workflow",
      "set_plan",
      "draft_step",
      "generate_input_spec",
      "generate_output_spec",
      "finalize_draft",
      this.isEditing ? "update_workflow_draft" : "create_workflow_draft",
    ]
  }
}

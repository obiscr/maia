import "server-only"

import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

/**
 * Tracks the orchestrator pipeline phase during a single streamText run.
 * Only used in Agent mode.
 *
 * Phase flow:
 *   plan → draft → specs → finalize → save → (text confirmation) → terminal
 *
 * Finalize may fail; when it does the model is allowed to go back to define_step
 * to repair individual steps, then retry validate_draft.
 *
 * Used by the chat route's `prepareStep` to gate tool availability and
 * by `stopWhen` to terminate generation after the workflow is saved.
 */
export class OrchestratorPhaseTracker {
  private readonly isEditing: boolean
  private readonly skipPlan: boolean
  private finalizeFailed = false
  private saveDone = false

  /** True once the model should stop generating. */
  terminal = false

  constructor(opts?: { isEditing?: boolean; skipPlan?: boolean }) {
    this.isEditing = Boolean(opts?.isEditing)
    this.skipPlan = Boolean(opts?.skipPlan)
  }

  /**
   * Process tool results from `onStepFinish`.
   * Updates internal phase based on which tools completed.
   */
  processToolResults(toolResults: ReadonlyArray<{ toolName: string; output: unknown }>) {
    for (const tr of toolResults) {
      const out = isPlainObject(tr.output) ? (tr.output as Record<string, unknown>) : null

      switch (tr.toolName) {
        case "validate_draft":
          if (out?.ok === true) {
            this.finalizeFailed = false
            this.saveDone = false
          } else {
            this.finalizeFailed = true
          }
          break
        case "define_step":
          if (this.finalizeFailed) {
            this.finalizeFailed = false
          }
          break
        case "create_workflow":
        case "update_workflow":
          if (out?.ok === true) {
            this.saveDone = true
            this.terminal = true
          }
          break
      }
    }

    if (!toolResults.length && this.saveDone) {
      this.terminal = true
    }
  }

  /**
   * Returns the orchestrator tool names available for the current phase.
   */
  activeTools(): string[] {
    return [
      "load_workflow",
      ...(this.skipPlan ? [] : ["create_plan"]),
      "define_step",
      "generate_input_spec",
      "generate_output_spec",
      "validate_draft",
      this.isEditing ? "update_workflow" : "create_workflow",
      "suggest_mode_switch",
    ]
  }
}

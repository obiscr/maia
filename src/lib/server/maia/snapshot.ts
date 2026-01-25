import { z } from "zod"

// Legacy snapshots (before reserved keys were versioned) only enforced `files` as system-managed.
const LEGACY_RESERVED_INITIAL_INPUT_KEYS = ["files"] as const

export const workflowSnapshotSchema = z.object({
  workflowId: z.string().min(1),
  workflowName: z.string().min(1),
  // Frozen execution environment (for reproducibility).
  // Defaults keep backward-compatibility for older runs that lack these fields.
  /**
   * Workflow dependencies (JSON string)
   */
  dependencies: z.string().default("{}"),
  /**
   * Workflow environment variables (JSON string)
   */
  envJson: z.string().default("{}"),
  /**
   * Workflow input spec (normalized JSON string) at snapshot time
   */
  inputSpec: z.string().nullable().default(null),
  /**
   * Workflow outputs spec (normalized JSON string) at snapshot time
   */
  outputsSpec: z.string().nullable().default(null),
  /**
   * Reserved top-level keys in user-provided initialInput at snapshot time.
   * Stored for reproducibility: older snapshots may omit this field and will default to legacy behavior.
   */
  reservedInitialInputKeys: z.array(z.string().min(1)).default([...LEGACY_RESERVED_INITIAL_INPUT_KEYS]),
  /**
   * Hash of workflow dependencies
   */
  depsHash: z.string().min(1),
  /**
   * Workflow steps
   */
  steps: z.array(
    z.object({
      stepKey: z.string().min(1),
      name: z.string().min(1),
      scriptEsm: z.string(),
      timeoutMs: z.number().int().positive(),
      deps: z.array(z.string().min(1)).default([]),
    }),
  ),
})

export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>

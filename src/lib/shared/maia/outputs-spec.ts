import { z } from "zod"

/**
 * WorkflowOutputsSpec (v1)
 *
 * Purpose: define a stable, named "run outputs" contract (GA-style),
 * mapped from step outputs produced by the engine contract:
 * - step output.json has shape: { ok, timestamp, data: { outputs: {...} } }
 *
 * v1 mapping rule:
 * - outputs is an object map: { [outputName]: { stepKey, field? } }
 * - stepKey: which step provides the source outputs object (data.outputs)
 * - field: optional; if present, select data.outputs[field]; otherwise select the full data.outputs object
 */

export const workflowOutputsSpecV1Schema = z.object({
  version: z.literal(1).default(1),
  outputs: z.record(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "output name must match /^[A-Za-z_][A-Za-z0-9_]*$/"),
    z.object({
      stepKey: z.string().min(1).max(200),
      field: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "field must match /^[A-Za-z_][A-Za-z0-9_]*$/")
        .optional(),
      title: z.string().trim().max(200).optional(),
      description: z.string().trim().max(4000).optional(),
    }),
  ),
})

export type WorkflowOutputsSpecV1 = z.infer<typeof workflowOutputsSpecV1Schema>

export function parseWorkflowOutputsSpec(raw: string | null | undefined): {
  spec: WorkflowOutputsSpecV1 | null
  error?: string
} {
  const s = typeof raw === "string" ? raw.trim() : ""
  if (!s) return { spec: null }
  try {
    const parsed = JSON.parse(s) as unknown
    const spec = workflowOutputsSpecV1Schema.parse(parsed)
    return { spec }
  } catch (e) {
    return { spec: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export function defaultWorkflowOutputsSpecV1(): WorkflowOutputsSpecV1 {
  return {
    version: 1,
    outputs: {
      result: { stepKey: "step_1" },
    },
  }
}

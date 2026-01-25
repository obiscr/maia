import { z } from "zod"

export const WORKFLOW_EXPORT_FORMAT_V1 = "maia.workflow.export.v1" as const

const stringMapSchema = z.record(z.string().min(1), z.string())

export const workflowExportV1Schema = z.object({
  format: z.literal(WORKFLOW_EXPORT_FORMAT_V1),
  exportedAt: z.string().min(1),
  workflow: z.object({
    id: z.string().min(1), // publicId, e.g. "wf-27"
    name: z.string().min(1),
    description: z.string().nullable().optional(),
  }),
  version: z
    .object({
      number: z.number().int().positive(),
      createdAt: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  flags: z
    .object({
      envIncluded: z.boolean().default(false),
    })
    .default({ envIncluded: false }),
  data: z.object({
    meta: z.object({
      name: z.string().min(1),
      description: z.string().nullable().optional(),
      reservedInitialInputKeys: z.array(z.string().min(1)).optional(),
    }),
    steps: z.array(
      z.object({
        stepKey: z.string().min(1),
        name: z.string().min(1),
        scriptEsm: z.string().default(""),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .default(10 * 60 * 1000),
        deps: z.array(z.string().min(1)).default([]),
      }),
    ),
    env: stringMapSchema.default({}),
    dependencies: stringMapSchema.default({}),
    inputSpec: z.unknown().nullable().optional(),
    outputsSpec: z.unknown().nullable().optional(),
  }),
})

export type WorkflowExportV1 = z.infer<typeof workflowExportV1Schema>

export function stableStringifyStringMap(obj: Record<string, string>) {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify(sorted, null, 2)
}

export function workflowExportV1ToCreateWorkflowPayload(exp: WorkflowExportV1) {
  const name = exp.data.meta.name
  const description = exp.data.meta.description ?? undefined
  const dependencies = stableStringifyStringMap(exp.data.dependencies ?? {})
  const envJson = stableStringifyStringMap(exp.data.env ?? {})
  const inputSpec =
    exp.data.inputSpec == null
      ? null
      : typeof exp.data.inputSpec === "string"
        ? exp.data.inputSpec
        : JSON.stringify(exp.data.inputSpec, null, 2)
  const outputsSpec =
    exp.data.outputsSpec == null
      ? null
      : typeof exp.data.outputsSpec === "string"
        ? exp.data.outputsSpec
        : JSON.stringify(exp.data.outputsSpec, null, 2)

  return {
    name,
    description,
    dependencies,
    envJson,
    inputSpec,
    outputsSpec,
    steps: exp.data.steps.map((s) => ({
      stepKey: s.stepKey,
      name: s.name,
      scriptEsm: s.scriptEsm ?? "",
      timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
      deps: s.deps ?? [],
    })),
  }
}

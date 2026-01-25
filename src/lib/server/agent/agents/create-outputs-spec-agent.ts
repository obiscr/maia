import { z } from "zod"

import type { AgentDefinition, ChatMessage, ToolDef } from "@/lib/shared/agent/types"
import { buildWorkflowContextPrompt, readWorkflowForAgent } from "@/lib/server/agent/workflow-context"
import { defaultWorkflowOutputsSpecV1, parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

const draftSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  dependencies: z.string().optional(),
  inputSpec: z.string().optional().nullable(),
  outputsSpec: z.string().optional().nullable(),
  steps: z
    .array(
      z.object({
        stepKey: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        scriptEsm: z.string().optional().default(""),
        timeoutMs: z.number().int().positive().optional(),
        deps: z.array(z.string().min(1)).optional().default([]),
      }),
    )
    .optional()
    .default([]),
})

const reqSchema = z
  .object({
    workflowId: z.string().trim().min(1).optional(),
    draft: draftSchema.optional(),
    locale: z.string().optional(),
    /**
     * Optional extra instructions from caller (kept small). Most callers can omit this.
     */
    instructions: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.workflowId && !v.draft) {
      ctx.addIssue({ code: "custom", path: ["workflowId"], message: "workflowId or draft is required" })
    }
  })

function buildSystemPrompt(params: { locale: string }) {
  const locale = String(params.locale ?? "").toLowerCase() || "en"
  const template = JSON.stringify(defaultWorkflowOutputsSpecV1(), null, 2)
  return [
    "You are CreateOutputsSpecAgent for Maia.",
    "Task: generate or update WorkflowOutputsSpec (v1) for the given workflow.",
    "Output contract:",
    "- You MUST call validate_outputs_spec with the final outputsSpec JSON (object) to finish.",
    "- Only produce outputsSpec. Do not modify workflow name/description/dependencies/inputSpec/steps.",
    `- Output language: for human-facing strings (title/description), match the user's locale (${locale}). If unclear, use English.`,
    "",
    "Guidance:",
    "- outputsSpec defines stable, named run outputs mapped from step outputs.",
    "- Each mapping selects from step output.json data.outputs.",
    "- Prefer a small set of clear outputs (1-5). Use names like result, report, items, summary.",
    "- Default behavior: if uncertain, map outputs.result from the last stepKey.",
    "",
    "Valid template you can start from:",
    template,
  ].join("\n")
}

const tools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "validate_outputs_spec",
      description:
        "Validate and normalize the final outputsSpec (WorkflowOutputsSpec v1). Returns a proposal payload shaped as { draft: { outputsSpec: <string> } }.",
      parameters: {
        type: "object",
        properties: {
          outputsSpec: {
            description: "WorkflowOutputsSpec JSON object (not a string).",
            type: "object",
          },
        },
        required: ["outputsSpec"],
      },
    },
  },
]

async function runTool(name: string, args: unknown) {
  if (name === "validate_outputs_spec") {
    const parsed = z.object({ outputsSpec: z.unknown() }).parse(args)
    const json = JSON.stringify(parsed.outputsSpec ?? {}, null, 2)
    const normalized = parseWorkflowOutputsSpec(json)
    if (!normalized.spec) {
      return { ok: false, error: normalized.error ?? "outputsSpec parse failed" }
    }
    return { ok: true, draft: { outputsSpec: JSON.stringify(normalized.spec, null, 2) }, warnings: [] }
  }
  throw new Error(`Unknown tool: ${name}`)
}

export const CreateOutputsSpecAgent: AgentDefinition<z.infer<typeof reqSchema>> = {
  id: "CreateOutputsSpecAgent",
  requestSchema: reqSchema,
  tools,
  isTerminalToolResult: ({ name, result }) => {
    if (name !== "validate_outputs_spec") return false
    return isPlainObject(result) && result.ok === true && isPlainObject(result.draft)
  },
  buildHistory: async ({ body, ctx }) => {
    const system: ChatMessage = { role: "system", content: buildSystemPrompt({ locale: ctx.locale }) }
    const wf = body.workflowId
      ? await readWorkflowForAgent(body.workflowId)
      : {
          id: "__draft__",
          name: String(body.draft?.name ?? "Draft"),
          description: body.draft?.description ?? null,
          dependencies: String(body.draft?.dependencies ?? "{}"),
          inputSpec: body.draft?.inputSpec ?? null,
          outputsSpec: body.draft?.outputsSpec ?? null,
          steps: (body.draft?.steps ?? []).map((s) => ({
            stepKey: s.stepKey,
            name: s.name,
            description: s.description ?? undefined,
            scriptEsm: String(s.scriptEsm ?? ""),
            timeoutMs: s.timeoutMs,
            deps: s.deps ?? [],
          })),
        }
    const workflowCtx: ChatMessage = { role: "system", content: buildWorkflowContextPrompt({ workflow: wf }) }

    const userMsg: ChatMessage = {
      role: "user",
      content: [
        "Generate/update outputsSpec for this workflow.",
        body.instructions ? `Extra instructions:\n${String(body.instructions).slice(0, 1200)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    }

    return [system, workflowCtx, userMsg]
  },
  runTool: async ({ name, args }) => runTool(name, args),
  onToolResult: ({ name, result, send }) => {
    if (name === "validate_outputs_spec") send("proposal", result)
  },
}

import { z } from "zod"

import type { AgentDefinition, ChatMessage, ToolDef } from "@/lib/shared/agent/types"
import { buildWorkflowContextPrompt, readWorkflowForAgent } from "@/lib/server/agent/workflow-context"
import { defaultWorkflowInputSpec, parseWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { compileJsonSchema } from "@/lib/server/maia/jsonschema"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

const draftSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  dependencies: z.string().optional(),
  inputSpec: z.string().optional().nullable(),
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
  const template = JSON.stringify(defaultWorkflowInputSpec(), null, 2)
  return [
    "You are CreateInputSchemaAgent for Maia.",
    "Task: generate or update WorkflowInputSpec (v2) for the given workflow.",
    "Output contract:",
    "- You MUST call validate_input_schema with the final inputSpec JSON (object) to finish.",
    "- Only produce inputSpec. Do not modify workflow name/description/dependencies/steps.",
    `- Output language: for human-facing strings (titles/descriptions/examples/uploadNotes), match the user's locale (${locale}). If unclear, use English.`,
    "Schema guidance:",
    "- paramsSchema must be a JSON Schema for a TOP-LEVEL object.",
    "- Prefer additionalProperties=false and keep required minimal (only truly required fields).",
    "- Prefer basic types: string/number/integer/boolean; arrays with items.type; enums via enum. Avoid anyOf/oneOf/allOf unless necessary.",
    "- Provide 1-3 examples; put the most common in examples[0] (UI only auto-prefills the first).",
    "- filesInput must be an object (or omitted), never an array.",
    "",
    "Valid template you can start from:",
    template,
  ].join("\n")
}

const tools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "validate_input_schema",
      description:
        "Validate and normalize the final inputSpec (WorkflowInputSpec v2). Returns a proposal payload shaped as { draft: { inputSpec: <string> } }.",
      parameters: {
        type: "object",
        properties: {
          inputSpec: {
            description: "WorkflowInputSpec JSON object (not a string).",
            type: "object",
          },
        },
        required: ["inputSpec"],
      },
    },
  },
]

async function runTool(name: string, args: unknown) {
  if (name === "validate_input_schema") {
    const parsed = z.object({ inputSpec: z.unknown() }).parse(args)
    const json = JSON.stringify(parsed.inputSpec ?? {}, null, 2)
    const normalized = parseWorkflowInputSpec(json)
    if (!normalized.spec) {
      return { ok: false, error: normalized.error ?? "inputSpec parse failed" }
    }
    const compiled = compileJsonSchema(normalized.spec.paramsSchema)
    if (compiled.compileError) {
      return { ok: false, error: `inputSpec.paramsSchema invalid: ${compiled.compileError}` }
    }
    return { ok: true, draft: { inputSpec: JSON.stringify(normalized.spec, null, 2) }, warnings: [] }
  }
  throw new Error(`Unknown tool: ${name}`)
}

export const CreateInputSchemaAgent: AgentDefinition<z.infer<typeof reqSchema>> = {
  id: "CreateInputSchemaAgent",
  requestSchema: reqSchema,
  tools,
  isTerminalToolResult: ({ name, result }) => {
    if (name !== "validate_input_schema") return false
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
        "Generate/update inputSpec for this workflow.",
        body.instructions ? `Extra instructions:\n${String(body.instructions).slice(0, 1200)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    }

    return [system, workflowCtx, userMsg]
  },
  runTool: async ({ name, args }) => runTool(name, args),
  onToolResult: ({ name, result, send }) => {
    if (name === "validate_input_schema") send("proposal", result)
  },
}

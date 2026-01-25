import { z } from "zod"

import type { AgentDefinition, ChatMessage, ToolDef } from "@/lib/shared/agent/types"
import { buildWorkflowContextPrompt, readWorkflowForAgent } from "@/lib/server/agent/workflow-context"
import { defaultWorkflowInputSpec, parseWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { compileJsonSchema } from "@/lib/server/maia/jsonschema"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

const reqSchema = z.object({
  workflowId: z.string().trim().min(1).optional(),
  locale: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .default([]),
})

const stepSchema = z.object({
  stepKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  scriptEsm: z.string().default(""),
  timeoutMs: z.number().int().positive().optional(),
  deps: z.array(z.string().min(1)).default([]),
})

const workflowDraftSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    dependencies: z.preprocess((v) => {
      if (typeof v === "string") return v
      if (v == null) return "{}"
      try {
        return JSON.stringify(v, null, 2)
      } catch {
        return "{}"
      }
    }, z.string().default("{}")),
    envJson: z.preprocess((v) => {
      if (typeof v === "string") return v
      if (v == null) return "{}"
      try {
        return JSON.stringify(v, null, 2)
      } catch {
        return "{}"
      }
    }, z.string().default("{}")),
    inputSpec: z.preprocess((v) => {
      if (typeof v === "string") return v
      if (v == null) return v
      try {
        return JSON.stringify(v, null, 2)
      } catch {
        return ""
      }
    }, z.string().nullable().optional()),
    steps: z.array(stepSchema).default([]),
  })
  .superRefine((w, ctx) => {
    try {
      const parsed = JSON.parse(w.dependencies || "{}")
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        ctx.addIssue({ code: "custom", message: "dependencies must be a JSON object string", path: ["dependencies"] })
      }
    } catch {
      ctx.addIssue({ code: "custom", message: "dependencies must be valid JSON", path: ["dependencies"] })
    }
    try {
      const parsed = JSON.parse(String(w.envJson ?? "{}") || "{}")
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        ctx.addIssue({ code: "custom", message: "envJson must be a JSON object string", path: ["envJson"] })
      }
    } catch {
      ctx.addIssue({ code: "custom", message: "envJson must be valid JSON", path: ["envJson"] })
    }
    const keys = w.steps.map((s) => s.stepKey)
    const dup = keys.find((k, i) => keys.indexOf(k) !== i)
    if (dup) ctx.addIssue({ code: "custom", message: `duplicate stepKey: ${dup}`, path: ["steps"] })

    // Validate deps references: every dep must point to an existing stepKey.
    // If not, the graph will render "floating" nodes or missing edges.
    const keySet = new Set(keys)
    for (let i = 0; i < w.steps.length; i++) {
      const s = w.steps[i]!
      for (const dep of s.deps ?? []) {
        if (!keySet.has(dep)) {
          ctx.addIssue({
            code: "custom",
            message: `step "${s.stepKey}" has unknown dep "${dep}" (missing stepKey)`,
            path: ["steps", i, "deps"],
          })
        }
      }
    }

    // Basic script structure validation to prevent invalid AI generations.
    for (let i = 0; i < w.steps.length; i++) {
      const s = w.steps[i]!
      const script = String(s.scriptEsm ?? "")
      const exportDefaultCount = (script.match(/\bexport\s+default\b/g) || []).length
      if (exportDefaultCount !== 1) {
        ctx.addIssue({
          code: "custom",
          message: `step "${s.stepKey}" script must contain exactly one "export default" (found ${exportDefaultCount})`,
          path: ["steps", i, "scriptEsm"],
        })
      }
      if (!/\bmain\s*\(/.test(script)) {
        ctx.addIssue({
          code: "custom",
          message: `step "${s.stepKey}" script should define a "main(env, ctx)" function (default export's main or a named export)`,
          path: ["steps", i, "scriptEsm"],
        })
      }
    }

    if (typeof w.inputSpec === "string" && w.inputSpec.trim()) {
      const parsed = parseWorkflowInputSpec(w.inputSpec)
      if (!parsed.spec) {
        ctx.addIssue({
          code: "custom",
          message: `inputSpec invalid: ${parsed.error ?? "parse failed"}`,
          path: ["inputSpec"],
        })
      } else {
        const compiled = compileJsonSchema(parsed.spec.paramsSchema)
        if (compiled.compileError) {
          ctx.addIssue({
            code: "custom",
            message: `inputSpec.paramsSchema invalid: ${compiled.compileError}`,
            path: ["inputSpec"],
          })
        }
      }
    }
  })

function buildSystemPrompt(params: { locale: string; workflowId?: string }) {
  const locale = String(params.locale ?? "").toLowerCase() || "en"
  const base = [
    "You are CreateWorkflowAgent, an expert workflow architect for Maia.",
    "Your goal: help the user plan and iterate an automation workflow (DAG), then produce a concrete workflow draft (name/description/dependencies/inputSpec/steps).",
    "Constraints:",
    `- Output language: match the user's locale (${locale}). If unclear, default to English.`,
    "- The workflow name must be a short, human-friendly title in the user's language. Do NOT use kebab-case or slug-style names.",
    "- The workflow name and description must reflect the user's intent. Avoid generic placeholders.",
    "- Keep the workflow name concise (ideally <= 60 characters). Description should be 1-2 sentences.",
    "- Steps are ESM scripts executed by Node (Worker-style handler).",
    "- Each step must export a main handler and RETURN a JSON-serializable value; the engine writes output.json automatically.",
    "- IMPORTANT: The JSON at MAIA_INPUT_PATH has this shape: { runId, stepKey, attemptNo, initialInput, upstream, dirs, paths }.",
    "- IMPORTANT: User-provided parameters are ALWAYS under input.initialInput. Never read user params from input.url / input.rssUrl / etc.",
    "- IMPORTANT: Dependency outputs are under input.upstream[<depStepKey>] (keyed by stepKey).",
    "- CRITICAL: Each upstream value is the FULL output.json object: { ok, timestamp, data }. Your step must read dependency results from upstream[depStepKey]?.data (NOT directly from upstream[depStepKey].field).",
    "- BEST PRACTICE: Standardize your step return shape as { outputs: { ... } }. Then downstream reads upstream[depStepKey]?.data?.outputs?.<field>.",
    "- CRITICAL: When you refer to upstream, use EXACT stepKey strings as keys (e.g. upstream.fetch_url?.data). Do NOT invent names like fetchUrl unless the stepKey is fetchUrl.",
    "- Use stepKey as stable identifiers (unique). Use deps to express dependencies by stepKey.",
    "- Unless the user explicitly requests parallel branches, prefer a single linear chain with ONE entry step: only the first step should have deps=[], and each subsequent step should depend on the previous stepKey.",
    "- Avoid creating multiple root steps (multiple steps with deps=[]), as it looks like multiple 'starts' in the graph UI.",
    '- dependencies is a JSON object string of npm deps (e.g. {"cheerio":"^1.0.0"}). Keep it minimal.',
    '- envJson (optional): a JSON object string of workflow-scoped env KV (e.g. {"OPENAI_API_KEY":"..."}). Keep it minimal.',
    "- inputSpec (recommended): a JSON string (WorkflowInputSpec v1) with paramsSchema/fileInputs/examples.",
    "- REQUIRED SCRIPT SKELETON (follow this structure; output EXACTLY ONE script per step):\n\n```js\nexport default {\n  async main(env, ctx) {\n    const { params, upstream, files, urls } = ctx;\n\n    // Write your logic here.\n\n    return {\n      outputs: {\n        // Put ONLY the outputs you want downstream steps to consume.\n      },\n    };\n  },\n};\n```\n",
    "Process:",
    "- Before you start planning, CALL ui_signal({phase:'plan', state:'start'}) first (this tells the UI to show the 'Generating plan…' bar).",
    "- Maintain a clear plan; publish it via update_plan when it changes. Provide a short plan title (title) suitable as a compact UI label (e.g. '抓取网页数据', '图片 OCR 提取', 'RSS 摘要').",
    "- CRITICAL ORDERING: Do NOT start drafting steps while you are still describing the planning stage in natural language.",
    "- After you have finished describing the plan in natural language AND published a complete plan via update_plan, CALL ui_signal({phase:'plan', state:'end'}).",
    "- Only AFTER ui_signal(plan,end), you may begin drafting: CALL ui_signal({phase:'draft', state:'start'}), then draft steps one by one.",
    "- While drafting the workflow, STREAM progress by calling publish_draft_step as soon as each step is ready (one tool call per step).",
    "- After all steps are drafted, call validate_workflow_payload with the FULL draft to finalize and validate.",
    "",
    "STRICT ORCHESTRATION PROTOCOL (MUST FOLLOW):",
    "- Treat this as a state machine. Do not skip or reorder phases.",
    "- You MUST NOT write long natural-language narration during tool-driven phases. Keep explanations short (1-3 lines) and prioritize tool calls.",
    "- Once drafting has started (after ui_signal({phase:'draft', state:'start'})), your primary output should be tool calls (publish_draft_step).",
    "- When you finish the last draft step, IMMEDIATELY do BOTH actions next (no extra narration in between):",
    "  1) ui_signal({phase:'draft', state:'end'})",
    "  2) validate_workflow_payload({ draft: <FULL DRAFT> })",
    "- Do NOT say 'I will validate' and then continue chatting. Validation must be executed via the tool call right away.",
    '- If you cannot produce a valid inputSpec v1, set inputSpec to an empty string ("") rather than outputting an invalid structure. (A separate agent can generate inputSpec later.)',
    "- If validate_workflow_payload reports ok:false, you MUST revise the draft and retry validate (limited retries), OR stop and ask the user for the missing info. Do not stall.",
  ]
  const editAdd = params.workflowId
    ? [
        "Context: the user is editing an existing workflow. You may ask for changes; the full workflow context is injected for you.",
      ]
    : ["Context: the user is creating a new workflow draft."]
  return [...base, ...editAdd].join("\n")
}

const toolGetWorkflow: ToolDef = {
  type: "function",
  function: {
    name: "get_workflow",
    description: "Load an existing workflow by ID (name/description/dependencies/inputSpec/steps with deps).",
    parameters: {
      type: "object",
      properties: { workflowId: { type: "string" } },
      required: ["workflowId"],
    },
  },
}

const toolUpdatePlan: ToolDef = {
  type: "function",
  function: {
    name: "update_plan",
    description: "Publish the current plan steps to render in UI.",
    parameters: {
      type: "object",
      properties: { title: { type: "string" }, steps: { type: "array", items: { type: "string" } } },
      required: ["steps"],
    },
  },
}

const toolUiSignal: ToolDef = {
  type: "function",
  function: {
    name: "ui_signal",
    description:
      "Emit a UI progress signal. Use this to explicitly coordinate UI state (planning/drafting) before you start those phases.",
    parameters: {
      type: "object",
      properties: {
        phase: { type: "string", enum: ["plan", "draft"] },
        state: { type: "string", enum: ["start", "end"] },
        stepIndex: { type: "number" },
        stepTitle: { type: "string" },
      },
      required: ["phase", "state"],
    },
  },
}

const toolPublishDraftStep: ToolDef = {
  type: "function",
  function: {
    name: "publish_draft_step",
    description:
      "Stream a single workflow step draft to the UI as soon as it's ready (for incremental graph rendering). Does NOT finalize the workflow.",
    parameters: {
      type: "object",
      properties: {
        step: {
          type: "object",
          properties: {
            stepKey: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            scriptEsm: { type: "string" },
            timeoutMs: { type: "number" },
            deps: { type: "array", items: { type: "string" } },
          },
          required: ["stepKey", "name", "scriptEsm", "deps"],
        },
      },
      required: ["step"],
    },
  },
}

const toolValidateWorkflowPayload: ToolDef = {
  type: "function",
  function: {
    name: "validate_workflow_payload",
    description: "Validate and normalize a full workflow draft. Use this once ready to propose a concrete draft.",
    parameters: {
      type: "object",
      properties: {
        draft: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            dependencies: { type: "string" },
            envJson: { type: "string" },
            inputSpec: { type: "string" },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  stepKey: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  scriptEsm: { type: "string" },
                  timeoutMs: { type: "number" },
                  deps: { type: "array", items: { type: "string" } },
                },
                required: ["stepKey", "name", "scriptEsm", "deps"],
              },
            },
          },
          required: ["name", "dependencies", "steps"],
        },
      },
      required: ["draft"],
    },
  },
}

// Two-pass tool surfaces:
// - plan: can read workflow, signal plan phase, and publish plan.
// - draft: can signal draft phase, stream steps, and finalize.
const planTools: ToolDef[] = [toolGetWorkflow, toolUiSignal, toolUpdatePlan]
const draftTools: ToolDef[] = [toolGetWorkflow, toolUiSignal, toolPublishDraftStep, toolValidateWorkflowPayload]

const tools: ToolDef[] = [
  toolGetWorkflow,
  toolUpdatePlan,
  toolUiSignal,
  toolPublishDraftStep,
  toolValidateWorkflowPayload,
]

function tryCoerceInputSpecV1(raw: string): { next: string; didChange: boolean } | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  let obj: unknown
  try {
    obj = JSON.parse(s)
  } catch {
    return null
  }
  if (!isPlainObject(obj)) return null

  let didChange = false
  const nextObj: Record<string, unknown> = { ...obj }
  if (nextObj.version !== 1) {
    nextObj.version = 1
    didChange = true
  }
  if (nextObj.fileInputs != null && !isPlainObject(nextObj.fileInputs)) {
    nextObj.fileInputs = defaultWorkflowInputSpec().fileInputs
    didChange = true
  }
  if (nextObj.paramsSchema == null || !isPlainObject(nextObj.paramsSchema)) {
    nextObj.paramsSchema = defaultWorkflowInputSpec().paramsSchema
    didChange = true
  }
  if (nextObj.examples != null && !Array.isArray(nextObj.examples)) {
    nextObj.examples = defaultWorkflowInputSpec().examples
    didChange = true
  }
  return { next: JSON.stringify(nextObj, null, 2), didChange }
}

async function runTool(name: string, args: unknown) {
  if (name === "get_workflow") {
    const parsed = z.object({ workflowId: z.string().min(1) }).parse(args)
    const workflow = await readWorkflowForAgent(parsed.workflowId)
    return { workflow }
  }
  if (name === "update_plan") {
    const parsed = z.object({ title: z.string().optional(), steps: z.array(z.string()).default([]) }).parse(args)
    return { ok: true, title: parsed.title ?? null, steps: parsed.steps }
  }
  if (name === "ui_signal") {
    const parsed = z
      .object({
        phase: z.enum(["plan", "draft"]),
        state: z.enum(["start", "end"]),
        stepIndex: z.number().int().nonnegative().optional(),
        stepTitle: z.string().optional(),
      })
      .parse(args)
    return { ok: true, ...parsed }
  }
  if (name === "publish_draft_step") {
    const parsed = z.object({ step: z.unknown() }).safeParse(args)
    if (!parsed.success) return { ok: false, error: "Invalid tool args: expected { step: <object> }" }
    const normalized = stepSchema.safeParse(parsed.data.step)
    if (!normalized.success) {
      return {
        ok: false,
        error: "Step draft validation failed",
        issues: normalized.error.issues.map((i) => ({ path: i.path, message: i.message })),
      }
    }
    return { ok: true, step: normalized.data }
  }
  if (name === "validate_workflow_payload") {
    const parsed = z.object({ draft: z.unknown() }).safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: "Invalid tool args: expected { draft: <object> }" }
    }

    const draft0 = parsed.data.draft
    const draftCandidate = isPlainObject(draft0) ? { ...(draft0 as Record<string, unknown>) } : draft0

    // Product-y resilience: common validation failures come from inputSpec being "almost v1" but with wrong shape.
    // Try to coerce/repair; if still invalid, drop it (empty string) so the workflow draft can validate and the user can
    // generate inputSpec later via CreateInputSchemaAgent.
    let inputSpecRepairWarning: string | null = null
    if (isPlainObject(draftCandidate)) {
      const dc = draftCandidate as Record<string, unknown>
      const raw = typeof dc.inputSpec === "string" ? String(dc.inputSpec) : ""
      const repaired = raw ? tryCoerceInputSpecV1(raw) : null
      if (repaired?.didChange) {
        dc.inputSpec = repaired.next
      }
    }

    let normalizedParsed = workflowDraftSchema.safeParse(draftCandidate)
    if (!normalizedParsed.success) {
      const hasInputSpecIssue = normalizedParsed.error.issues.some((i) => (i.path ?? []).includes("inputSpec"))
      if (hasInputSpecIssue && isPlainObject(draftCandidate)) {
        // Try one more time by clearing invalid inputSpec (prevents "stuck validating" UX).
        const dc = draftCandidate as Record<string, unknown>
        const raw = typeof dc.inputSpec === "string" ? String(dc.inputSpec) : ""
        if (raw.trim()) {
          dc.inputSpec = ""
          inputSpecRepairWarning =
            "inputSpec was invalid and has been cleared to allow draft validation. You can regenerate a proper inputSpec later."
          normalizedParsed = workflowDraftSchema.safeParse(draftCandidate)
        }
      }
    }
    if (!normalizedParsed.success) {
      return {
        ok: false,
        error: "Workflow draft validation failed",
        issues: normalizedParsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      }
    }
    const normalized = normalizedParsed.data

    const warnings: string[] = []
    if (!normalized.steps.length) warnings.push("No steps in draft.")
    const n = String(normalized.name ?? "").trim()
    const d = String(normalized.description ?? "").trim()
    const looksLikeSlug = (s: string) => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(s)
    if (!n) warnings.push("Missing workflow name.")
    if (looksLikeSlug(n))
      warnings.push("Workflow name looks like a slug; use a human-friendly title in the user's language.")
    if (!d) warnings.push("Missing workflow description (add 1-2 sentences).")
    if (!String(normalized.inputSpec ?? "").trim()) {
      warnings.push(
        'Missing inputSpec (recommended): add a JSON string with version=1 and paramsSchema to improve "Create Job" UX and enable validation.',
      )
    }
    if (inputSpecRepairWarning) warnings.push(inputSpecRepairWarning)
    return { ok: true, draft: normalized, warnings }
  }
  throw new Error(`Unknown tool: ${name}`)
}

export const CreateWorkflowAgent: AgentDefinition<z.infer<typeof reqSchema>> = {
  id: "CreateWorkflowAgent",
  requestSchema: reqSchema,
  tools,
  getTools: ({ phase }) => (phase === "plan" ? planTools : draftTools),
  isTerminalToolResult: ({ name, result }) => {
    // Once we have a validated draft proposal, we should stop streaming to avoid extra narration.
    if (name !== "validate_workflow_payload") return false
    return isPlainObject(result) && result.ok === true && isPlainObject(result.draft)
  },
  buildHistory: async ({ body, ctx }) => {
    const system: ChatMessage = {
      role: "system",
      content: buildSystemPrompt({ locale: ctx.locale, workflowId: ctx.workflowId }),
    }

    let workflowCtxMsg: ChatMessage | null = null
    if (ctx.workflowId) {
      const wf = await readWorkflowForAgent(ctx.workflowId)
      workflowCtxMsg = { role: "system", content: buildWorkflowContextPrompt({ workflow: wf }) }
    }

    return [
      system,
      ...(workflowCtxMsg ? [workflowCtxMsg] : []),
      ...body.messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    ]
  },
  runTool: async ({ name, args }) => runTool(name, args),
  onToolResult: ({ name, result, send }) => {
    if (name === "update_plan") send("plan", result)
    if (name === "ui_signal") send("ui", result)
    if (name === "publish_draft_step") send("draft_step", result)
    if (name === "validate_workflow_payload") send("proposal", result)
  },
}

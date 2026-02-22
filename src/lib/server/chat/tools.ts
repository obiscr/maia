import "server-only"

import { parse } from "@babel/parser"
import traverse from "@babel/traverse"
import type { Expression, MemberExpression, ObjectPattern, OptionalMemberExpression } from "@babel/types"
import { LRUCache } from "lru-cache"
import { z } from "zod"
import { generateText, stepCountIs, tool, type ToolSet } from "ai"

import { createOpenRouterModel } from "@/lib/server/agent/openrouter"
import { listRegisteredTools } from "@/lib/server/tools/registry"
import { executeRegisteredToolWithOperation } from "@/lib/server/tools/executor"
import { parseWorkflowInputSpec, defaultWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { parseWorkflowOutputsSpec, defaultWorkflowOutputsSpecV1 } from "@/lib/shared/maia/outputs-spec"
import { compileJsonSchema } from "@/lib/server/maia/jsonschema"
import { validateCronExpression } from "@/lib/server/maia/scheduler"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"
import type { ToolExecutionContext } from "@/lib/server/tools/types"
import { canonicalToSdkToolName } from "@/lib/shared/agent/tool-parts"

const CTX_PARAMS_KEYS_CACHE = new LRUCache<string, string[]>({ max: 500 })

function readMemberKey(node: MemberExpression | OptionalMemberExpression): string | null {
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name
  }
  if (node.computed && node.property.type === "StringLiteral") {
    return node.property.value
  }
  return null
}

function isCtxParamsExpression(node: Expression | null | undefined): boolean {
  if (!node) return false
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return false
  if (node.object.type !== "Identifier" || node.object.name !== "ctx") return false
  const key = readMemberKey(node)
  return key === "params"
}

function collectObjectPatternKeysFromParams(pattern: ObjectPattern): string[] {
  const out: string[] = []
  for (const p of pattern.properties) {
    if (p.type !== "ObjectProperty") continue
    const k = p.key
    if (k.type === "Identifier") out.push(k.name)
    else if (k.type === "StringLiteral") out.push(k.value)
  }
  return out
}

function extractCtxParamsKeysRegex(scriptEsm: string): string[] {
  const s = String(scriptEsm ?? "")
  if (!s) return []

  const keys = new Set<string>()

  // ctx.params.foo / ctx?.params.foo
  for (const m of s.matchAll(/\bctx\??\.params\??\.([a-zA-Z_$][\w$]*)\b/g)) {
    if (m[1]) keys.add(m[1])
  }
  // ctx.params["foo"] / ctx.params['foo']
  for (const m of s.matchAll(/\bctx\??\.params\??\.\s*\[\s*["']([^"']+)["']\s*\]/g)) {
    if (m[1]) keys.add(m[1])
  }
  // const { a, b: alias, c = 1 } = ctx.params
  for (const m of s.matchAll(/\bconst\s*\{\s*([^}]+)\s*\}\s*=\s*ctx\??\.params\b/g)) {
    const inner = String(m[1] ?? "")
    for (const raw of inner.split(",")) {
      const tok = raw.trim()
      if (!tok) continue
      const name = tok.split(":")[0]!.split("=")[0]!.trim()
      if (/^[a-zA-Z_$][\w$]*$/.test(name)) keys.add(name)
    }
  }

  // If the script binds params = ctx.params, allow scanning params.xxx with reduced false positives.
  const bindsParams =
    /\bconst\s*\{\s*params\s*\}\s*=\s*ctx\b/.test(s) ||
    /\bconst\s+params\s*=\s*ctx\??\.params\b/.test(s) ||
    /\blet\s+params\s*=\s*ctx\??\.params\b/.test(s)
  if (bindsParams) {
    for (const m of s.matchAll(/\bparams\??\.([a-zA-Z_$][\w$]*)\b/g)) {
      if (m[1]) keys.add(m[1])
    }
    for (const m of s.matchAll(/\bparams\??\.\s*\[\s*["']([^"']+)["']\s*\]/g)) {
      if (m[1]) keys.add(m[1])
    }
  }

  return [...keys].sort()
}

function extractCtxParamsKeysAst(scriptEsm: string): string[] {
  const ast = parse(scriptEsm, {
    sourceType: "unambiguous",
    plugins: ["typescript", "jsx"],
    errorRecovery: true,
  })
  const keys = new Set<string>()
  const paramsAliases = new Set<string>()

  const addMemberKey = (node: MemberExpression | OptionalMemberExpression) => {
    const object = node.object
    const objectIsCtxParams = object.type === "Identifier" ? false : isCtxParamsExpression(object)
    const objectIsAlias = object.type === "Identifier" && paramsAliases.has(object.name)
    if (!objectIsCtxParams && !objectIsAlias) return
    const key = readMemberKey(node)
    if (key) keys.add(key)
  }

  traverse(ast, {
    VariableDeclarator(path) {
      const init = path.node.init
      const id = path.node.id
      if (!init) return

      const initIsCtxParams = isCtxParamsExpression(init)
      const initIsAlias = init.type === "Identifier" && paramsAliases.has(init.name)
      if (!initIsCtxParams && !initIsAlias) {
        // Handle: const { params } = ctx  / const { params: p } = ctx
        if (init.type === "Identifier" && init.name === "ctx" && id.type === "ObjectPattern") {
          for (const p of id.properties) {
            if (p.type !== "ObjectProperty") continue
            const key = p.key.type === "Identifier" ? p.key.name : p.key.type === "StringLiteral" ? p.key.value : null
            if (key !== "params") continue
            if (p.value.type === "Identifier") paramsAliases.add(p.value.name)
          }
        }
        return
      }

      if (id.type === "Identifier") {
        paramsAliases.add(id.name)
        return
      }

      if (id.type === "ObjectPattern") {
        for (const k of collectObjectPatternKeysFromParams(id)) {
          keys.add(k)
        }
      }
    },

    AssignmentExpression(path) {
      const left = path.node.left
      const right = path.node.right
      if (left.type !== "Identifier") return
      if (isCtxParamsExpression(right)) {
        paramsAliases.add(left.name)
        return
      }
      if (right.type === "Identifier" && paramsAliases.has(right.name)) {
        paramsAliases.add(left.name)
      }
    },

    MemberExpression(path) {
      addMemberKey(path.node)
    },

    OptionalMemberExpression(path) {
      addMemberKey(path.node)
    },
  })

  return [...keys].sort()
}

function extractCtxParamsKeys(scriptEsm: string): string[] {
  const s = String(scriptEsm ?? "")
  if (!s) return []
  const cached = CTX_PARAMS_KEYS_CACHE.get(s)
  if (cached) return [...cached]

  let keys: string[]
  try {
    keys = extractCtxParamsKeysAst(s)
  } catch {
    keys = extractCtxParamsKeysRegex(s)
  }

  CTX_PARAMS_KEYS_CACHE.set(s, keys)
  return [...keys]
}

// ---------------------------------------------------------------------------
// Workflow draft validation schema
// ---------------------------------------------------------------------------

export const stepSchema = z.object({
  stepKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  scriptEsm: z.string().default(""),
  timeoutMs: z.preprocess((v) => {
    const n = typeof v === "string" ? Number(v.trim()) : typeof v === "number" ? v : NaN
    if (!Number.isFinite(n)) return undefined
    const i = Math.floor(n)
    return i > 0 ? i : undefined
  }, z.number().int().positive().optional()),
  deps: z.array(z.string().min(1)).default([]),
})

export const workflowDraftSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    dependencies: z.preprocess(
      (v) =>
        typeof v === "string"
          ? v
          : v == null
            ? "{}"
            : (() => {
                try {
                  return JSON.stringify(v, null, 2)
                } catch {
                  return "{}"
                }
              })(),
      z.string().default("{}"),
    ),
    envJson: z.preprocess(
      (v) =>
        typeof v === "string"
          ? v
          : v == null
            ? "{}"
            : (() => {
                try {
                  return JSON.stringify(v, null, 2)
                } catch {
                  return "{}"
                }
              })(),
      z.string().default("{}"),
    ),
    inputSpec: z.preprocess(
      (v) =>
        typeof v === "string"
          ? v
          : v == null
            ? v
            : (() => {
                try {
                  return JSON.stringify(v, null, 2)
                } catch {
                  return ""
                }
              })(),
      z.string().nullable().optional(),
    ),
    outputsSpec: z.preprocess(
      (v) =>
        typeof v === "string"
          ? v
          : v == null
            ? v
            : (() => {
                try {
                  return JSON.stringify(v, null, 2)
                } catch {
                  return ""
                }
              })(),
      z.string().nullable().optional(),
    ),
    steps: z.array(stepSchema).default([]),
  })
  .superRefine((w, ctx) => {
    try {
      const p = JSON.parse(w.dependencies || "{}")
      if (!p || typeof p !== "object" || Array.isArray(p))
        ctx.addIssue({ code: "custom", message: "dependencies must be a JSON object", path: ["dependencies"] })
    } catch {
      ctx.addIssue({ code: "custom", message: "dependencies must be valid JSON", path: ["dependencies"] })
    }
    const keys = w.steps.map((s) => s.stepKey)
    const dup = keys.find((k, i) => keys.indexOf(k) !== i)
    if (dup) ctx.addIssue({ code: "custom", message: `duplicate stepKey: ${dup}`, path: ["steps"] })
    const keySet = new Set(keys)
    for (let i = 0; i < w.steps.length; i++) {
      for (const dep of w.steps[i]!.deps ?? []) {
        if (!keySet.has(dep))
          ctx.addIssue({
            code: "custom",
            message: `step "${w.steps[i]!.stepKey}" has unknown dep "${dep}"`,
            path: ["steps", i, "deps"],
          })
      }
    }
    for (let i = 0; i < w.steps.length; i++) {
      const script = String(w.steps[i]!.scriptEsm ?? "")
      if ((script.match(/\bexport\s+default\b/g) || []).length !== 1)
        ctx.addIssue({
          code: "custom",
          message: `step "${w.steps[i]!.stepKey}" must have exactly one "export default"`,
          path: ["steps", i, "scriptEsm"],
        })
    }
    if (typeof w.inputSpec === "string" && w.inputSpec.trim()) {
      const parsed = parseWorkflowInputSpec(w.inputSpec)
      if (!parsed.spec)
        ctx.addIssue({ code: "custom", message: `inputSpec invalid: ${parsed.error}`, path: ["inputSpec"] })
      else {
        const compiled = compileJsonSchema(parsed.spec.paramsSchema)
        if (compiled.compileError)
          ctx.addIssue({
            code: "custom",
            message: `inputSpec schema invalid: ${compiled.compileError}`,
            path: ["inputSpec"],
          })
      }
    }
  })

// ---------------------------------------------------------------------------
// Sub-agent: generate inputSpec
// ---------------------------------------------------------------------------

export async function generateInputSpec(params: {
  draft: Record<string, unknown>
  locale: string
  model: ReturnType<typeof createOpenRouterModel>
}): Promise<string | null> {
  try {
    const template = JSON.stringify(defaultWorkflowInputSpec(), null, 2)
    const systemPrompt = [
      "You are WorkflowInputSpecProfile for Maia.",
      "Task: generate WorkflowInputSpec (v2) for the given workflow.",
      "- You MUST call validate_input_schema with the final inputSpec JSON to finish.",
      `- Use the user's locale (${params.locale}) for human-facing strings.`,
      "- paramsSchema must be a JSON Schema for a TOP-LEVEL object.",
      "- Provide 1-3 examples.",
      `Valid template: ${template}`,
    ].join("\n")

    const steps = Array.isArray((params.draft as Record<string, unknown>)?.steps)
      ? (((params.draft as Record<string, unknown>).steps ?? []) as unknown[])
      : []
    const slimDraft = {
      steps: steps.map((s) => {
        if (!isPlainObject(s)) return s
        const st = s as Record<string, unknown>
        const script = typeof st.scriptEsm === "string" ? st.scriptEsm : ""
        return {
          stepKey: st.stepKey,
          name: st.name,
          description: st.description,
          deps: st.deps,
          timeoutMs: st.timeoutMs,
          paramsKeys: extractCtxParamsKeys(script),
        }
      }),
    }
    const draftContext = JSON.stringify(slimDraft, null, 2).slice(0, 6000)
    const result = await generateText({
      model: params.model,
      system: systemPrompt,
      messages: [{ role: "user" as const, content: `Generate inputSpec for this workflow draft:\n${draftContext}` }],
      tools: {
        validate_input_schema: tool({
          description: "Validate and normalize the final inputSpec.",
          inputSchema: z.object({ inputSpec: z.record(z.string(), z.unknown()) }),
          execute: async ({ inputSpec }: { inputSpec: Record<string, unknown> }) => {
            const json = JSON.stringify(inputSpec, null, 2)
            const parsed = parseWorkflowInputSpec(json)
            if (!parsed.spec) return { ok: false as const, error: parsed.error }
            const compiled = compileJsonSchema(parsed.spec.paramsSchema)
            if (compiled.compileError) return { ok: false as const, error: compiled.compileError }
            return { ok: true as const, inputSpec: JSON.stringify(parsed.spec, null, 2) }
          },
        }),
      },
      stopWhen: stepCountIs(10),
      temperature: 0.2,
    })

    for (const step of result.steps) {
      for (const r of step.toolResults) {
        if (
          r.toolName === "validate_input_schema" &&
          isPlainObject(r.output) &&
          (r.output as Record<string, unknown>).ok === true
        ) {
          return (r.output as Record<string, unknown>).inputSpec as string
        }
      }
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Sub-agent: generate outputsSpec
// ---------------------------------------------------------------------------

export async function generateOutputsSpec(params: {
  draft: Record<string, unknown>
  locale: string
  model: ReturnType<typeof createOpenRouterModel>
}): Promise<string | null> {
  try {
    const template = JSON.stringify(defaultWorkflowOutputsSpecV1(), null, 2)
    const systemPrompt = [
      "You are WorkflowOutputsSpecProfile for Maia.",
      "Task: generate WorkflowOutputsSpec (v1) for the given workflow.",
      "- You MUST call validate_outputs_spec with the final outputsSpec JSON to finish.",
      `- Use the user's locale (${params.locale}) for human-facing strings.`,
      "- Prefer 1-5 clear outputs mapped from step data.outputs.",
      `Valid template: ${template}`,
    ].join("\n")

    const steps = Array.isArray((params.draft as Record<string, unknown>)?.steps)
      ? (((params.draft as Record<string, unknown>).steps ?? []) as unknown[])
      : []
    const slimDraft = {
      steps: steps.map((s) => {
        if (!isPlainObject(s)) return s
        const st = s as Record<string, unknown>
        const script = typeof st.scriptEsm === "string" ? st.scriptEsm : ""
        return {
          stepKey: st.stepKey,
          name: st.name,
          description: st.description,
          deps: st.deps,
          timeoutMs: st.timeoutMs,
          paramsKeys: extractCtxParamsKeys(script),
        }
      }),
    }
    const draftContext = JSON.stringify(slimDraft, null, 2).slice(0, 6000)
    const result = await generateText({
      model: params.model,
      system: systemPrompt,
      messages: [{ role: "user" as const, content: `Generate outputsSpec for this workflow draft:\n${draftContext}` }],
      tools: {
        validate_outputs_spec: tool({
          description: "Validate and normalize the final outputsSpec.",
          inputSchema: z.object({ outputsSpec: z.record(z.string(), z.unknown()) }),
          execute: async ({ outputsSpec }: { outputsSpec: Record<string, unknown> }) => {
            const json = JSON.stringify(outputsSpec, null, 2)
            const parsed = parseWorkflowOutputsSpec(json)
            if (!parsed.spec) return { ok: false as const, error: parsed.error }
            return { ok: true as const, outputsSpec: JSON.stringify(parsed.spec, null, 2) }
          },
        }),
      },
      stopWhen: stepCountIs(10),
      temperature: 0.2,
    })

    for (const step of result.steps) {
      for (const r of step.toolResults) {
        if (
          r.toolName === "validate_outputs_spec" &&
          isPlainObject(r.output) &&
          (r.output as Record<string, unknown>).ok === true
        ) {
          return (r.output as Record<string, unknown>).outputsSpec as string
        }
      }
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Sub-agent: generate CRON expression (5-field)
// ---------------------------------------------------------------------------

export type GenerateCronExpressionResult =
  | { ok: true; cron: string }
  | { ok: false; code: "CRON_INTENT_UNCLEAR" | "CRON_NOT_EXPRESSIBLE" | "CRON_GENERATION_FAILED" }

export async function generateCronExpression(params: {
  prompt: string
  locale: string
  model: ReturnType<typeof createOpenRouterModel>
}): Promise<GenerateCronExpressionResult> {
  try {
    const systemPrompt = [
      "You are CronExpressionProfile for Maia.",
      "Task: Convert the user's scheduling intent into a valid 5-field Vixie cron expression: 'min hour dom mon dow'.",
      "- You MUST call validate_cron_expression with the final cron to finish.",
      "- If the user's intent is unclear or underspecified, call unclear_intent instead (do not guess).",
      "- If the intent is clear but NOT representable in 5-field Vixie cron semantics, call not_expressible instead.",
      `- Use the user's locale (${params.locale}) for any human-facing strings (only if needed).`,
      "- Output MUST be a 5-field cron (no seconds, no year).",
      "- Use 24-hour time. If user says '9am', interpret as 09:00.",
      "- Keep it simple and conventional (e.g. weekdays => '1-5' in DOW).",
      "- IMPORTANT limitation: Vixie cron cannot precisely express 'nth weekday of month' (e.g. 'second Wednesday') using DOM+DOW together (it becomes OR).",
      "- Do not include any explanation in the cron; only produce the cron via the tool call.",
    ].join("\n")

    const result = await generateText({
      model: params.model,
      system: systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: [
            "User scheduling intent:",
            String(params.prompt ?? "")
              .trim()
              .slice(0, 2000),
            "",
            "Reminder: produce a 5-field cron: min hour dom mon dow.",
          ].join("\n"),
        },
      ],
      tools: {
        validate_cron_expression: tool({
          description: "Validate and normalize a 5-field Vixie cron expression.",
          inputSchema: z.object({ cron: z.string() }),
          execute: async ({ cron }: { cron: string }) => {
            const expr = String(cron ?? "")
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .join(" ")
            try {
              validateCronExpression(expr)
              return { ok: true as const, cron: expr }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              return { ok: false as const, error: msg || "Invalid cron expression" }
            }
          },
        }),
        unclear_intent: tool({
          description: "Use when the user's intent is unclear or underspecified.",
          inputSchema: z.object({ reason: z.string().optional() }),
          execute: async ({ reason: _reason }: { reason?: string }) => ({
            ok: true as const,
            code: "CRON_INTENT_UNCLEAR" as const,
          }),
        }),
        not_expressible: tool({
          description: "Use when the user's intent is clear but cannot be represented in 5-field Vixie cron semantics.",
          inputSchema: z.object({ reason: z.string().optional() }),
          execute: async ({ reason: _reason }: { reason?: string }) => ({
            ok: true as const,
            code: "CRON_NOT_EXPRESSIBLE" as const,
          }),
        }),
      },
      stopWhen: stepCountIs(8),
      temperature: 0.1,
    })

    for (const step of result.steps) {
      for (const r of step.toolResults) {
        if (
          r.toolName === "validate_cron_expression" &&
          isPlainObject(r.output) &&
          (r.output as Record<string, unknown>).ok === true
        ) {
          return { ok: true as const, cron: String((r.output as Record<string, unknown>).cron ?? "").trim() }
        }
        if (
          r.toolName === "unclear_intent" &&
          isPlainObject(r.output) &&
          (r.output as Record<string, unknown>).ok === true
        ) {
          return { ok: false as const, code: "CRON_INTENT_UNCLEAR" as const }
        }
        if (
          r.toolName === "not_expressible" &&
          isPlainObject(r.output) &&
          (r.output as Record<string, unknown>).ok === true
        ) {
          return { ok: false as const, code: "CRON_NOT_EXPRESSIBLE" as const }
        }
      }
    }
    return { ok: false as const, code: "CRON_GENERATION_FAILED" as const }
  } catch {
    return { ok: false as const, code: "CRON_GENERATION_FAILED" as const }
  }
}

// ---------------------------------------------------------------------------
// Build tool sets
// ---------------------------------------------------------------------------

export function buildRegistryTools(ctx: ToolExecutionContext): ToolSet {
  const registered = listRegisteredTools().filter((t) => !t.internalOnly)
  const seen = new Set<string>()
  const entries = registered.map((t) => {
    const aiName = canonicalToSdkToolName(t.name)
    if (seen.has(aiName)) {
      throw new Error(`TOOL_NAME_COLLISION: ${t.name} -> ${aiName}`)
    }
    seen.add(aiName)
    return [
      aiName,
      tool({
        description: t.description,
        inputSchema: t.inputSchema,
        needsApproval: t.riskLevel === "destructive",
        execute: async (input: unknown) => executeRegisteredToolWithOperation({ name: t.name, input, ctx }),
      }),
    ] as const
  })
  return Object.fromEntries(entries)
}

export type OrchestratorSharedState = {
  draftSteps: Array<Record<string, unknown>>
  generatedInputSpec: string | null
  generatedOutputsSpec: string | null
  finalizedDraft: Record<string, unknown> | null
}

export function buildOrchestratorTools(params: {
  toolCtx: ToolExecutionContext
  model: ReturnType<typeof createOpenRouterModel>
  locale: string
  shared: OrchestratorSharedState
  onPlanUpdate: (title: string | null, stepsLen: number) => void
  onDraftStep: () => void
}): ToolSet {
  const { toolCtx, onPlanUpdate, onDraftStep } = params
  const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000

  return {
    get_workflow: tool({
      description: "Load an existing workflow by ID (name/description/dependencies/inputSpec/steps with deps).",
      inputSchema: z.object({ workflowId: z.string() }),
      execute: async ({ workflowId }: { workflowId: string }) =>
        executeRegisteredToolWithOperation({ name: "workflow.get", input: { id: workflowId }, ctx: toolCtx }),
    }),

    set_plan: tool({
      description: "Set the current workflow plan. Replaces any previous plan.",
      inputSchema: z.object({
        title: z.string().optional(),
        steps: z.array(
          z.object({
            name: z.string().describe("Short step name (will appear as the step title)"),
            description: z.string().describe("Brief description of what this step does"),
          }),
        ),
      }),
      execute: async ({ title, steps }: { title?: string; steps: { name: string; description: string }[] }) => {
        params.shared.draftSteps = []
        params.shared.generatedInputSpec = null
        params.shared.generatedOutputsSpec = null
        params.shared.finalizedDraft = null
        onPlanUpdate(title ?? null, steps.length)
        return { ok: true }
      },
    }),

    draft_step: tool({
      description:
        "Draft a single workflow step. " + "Re-drafting an existing stepKey replaces the previous version (upsert).",
      inputSchema: z.object({ step: stepSchema }),
      execute: async ({ step }: { step: z.infer<typeof stepSchema> }) => {
        const key = String(step.stepKey ?? "").trim()
        const idx = key ? params.shared.draftSteps.findIndex((s) => String(s.stepKey ?? "").trim() === key) : -1
        if (idx >= 0) {
          params.shared.draftSteps[idx] = step as unknown as Record<string, unknown>
          params.shared.finalizedDraft = null
        } else {
          params.shared.draftSteps.push(step as unknown as Record<string, unknown>)
          onDraftStep()
        }
        return { ok: true }
      },
    }),

    generate_input_spec: tool({
      description: "Generate inputSpec for the workflow draft. Called automatically after all steps are drafted.",
      inputSchema: z.object({}),
      execute: async () => {
        const draft = { steps: params.shared.draftSteps } as Record<string, unknown>
        const inputSpec = await generateInputSpec({ draft, locale: params.locale, model: params.model })
        if (!inputSpec) return { ok: false, error: "InputSpec generation failed." }
        params.shared.generatedInputSpec = inputSpec
        return { ok: true, inputSpec }
      },
    }),

    generate_output_spec: tool({
      description: "Generate outputsSpec for the workflow draft. Called automatically after all steps are drafted.",
      inputSchema: z.object({}),
      execute: async () => {
        const draft = { steps: params.shared.draftSteps } as Record<string, unknown>
        const outputsSpec = await generateOutputsSpec({ draft, locale: params.locale, model: params.model })
        if (!outputsSpec) return { ok: false, error: "OutputsSpec generation failed." }
        params.shared.generatedOutputsSpec = outputsSpec
        return { ok: true, outputsSpec }
      },
    }),

    finalize_draft: tool({
      description: "Validate the full workflow draft and finalize. Generated specs are merged automatically.",
      inputSchema: z.object({
        draft: z.object({
          name: z.string(),
          description: z.string().optional(),
          dependencies: z.string().optional(),
          envJson: z.string().optional(),
          inputSpec: z.string().optional(),
          outputsSpec: z.string().optional(),
          // Allow omitting steps to reduce token usage; server-side shared state is authoritative.
          steps: z
            .array(
              z.object({
                stepKey: z.string(),
                name: z.string(),
                description: z.string().optional(),
                scriptEsm: z.string(),
                timeoutMs: z.number().optional(),
                deps: z.array(z.string()),
              }),
            )
            .optional(),
        }),
      }),
      execute: async ({ draft }: { draft: Record<string, unknown> }) => {
        const draftCandidate = { ...draft } as Record<string, unknown>

        // Steps are drafted via `draft_step` (upserted into shared state). Treat shared state
        // as authoritative to avoid placeholder scripts (e.g. "[omitted from model context]").
        if (params.shared.draftSteps.length > 0) {
          draftCandidate.steps = params.shared.draftSteps
        }

        // Pre-normalize deps: keep ONLY deps that reference other stepKeys.
        // Some models mistakenly put npm packages into deps (those belong in `dependencies`).
        const stepsForDeps = Array.isArray(draftCandidate.steps) ? (draftCandidate.steps as unknown[]) : []
        if (stepsForDeps.length) {
          const keys = new Set(
            stepsForDeps
              .map((s) => (isPlainObject(s) ? String((s as Record<string, unknown>).stepKey ?? "").trim() : ""))
              .filter(Boolean),
          )
          if (keys.size) {
            draftCandidate.steps = stepsForDeps.map((s) => {
              if (!isPlainObject(s)) return s
              const st = s as Record<string, unknown>
              const depsRaw = Array.isArray(st.deps) ? (st.deps as unknown[]) : []
              const deps = depsRaw.map((d) => String(d ?? "").trim()).filter((d) => d && keys.has(d))
              return { ...st, deps }
            })
          }
        }

        if (params.shared.generatedInputSpec && !draftCandidate.inputSpec) {
          draftCandidate.inputSpec = params.shared.generatedInputSpec
        }
        if (params.shared.generatedOutputsSpec && !draftCandidate.outputsSpec) {
          draftCandidate.outputsSpec = params.shared.generatedOutputsSpec
        }

        let parsed = workflowDraftSchema.safeParse(draftCandidate)
        if (!parsed.success) {
          const hasInputSpecIssue = parsed.error.issues.some((i) => i.path.includes("inputSpec"))
          if (hasInputSpecIssue) {
            draftCandidate.inputSpec = ""
            parsed = workflowDraftSchema.safeParse(draftCandidate)
          }
        }
        if (!parsed.success) {
          return {
            ok: false,
            error: "Workflow draft validation failed",
            issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
          }
        }
        const normalized = parsed.data

        // Normalize step timeouts: ensure every step has a positive integer timeoutMs.
        // Use the platform default to keep the system stable across model quirks.
        const normalizedSteps = (normalized.steps ?? []).map((st) => {
          const raw = (st as unknown as { timeoutMs?: unknown }).timeoutMs
          const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN
          const i = Number.isFinite(n) ? Math.floor(n) : NaN
          const timeoutMs = Number.isFinite(i) && i > 0 ? i : DEFAULT_STEP_TIMEOUT_MS
          return { ...st, timeoutMs }
        })

        // If the model forgot deps entirely (common), default to a simple linear chain.
        // This matches the orchestrator's "prefer a single linear chain" guidance and
        // improves graph connectivity without relying on model-specific quirks.
        const totalDeps = normalizedSteps.reduce((sum, st) => sum + (Array.isArray(st.deps) ? st.deps.length : 0), 0)
        if (normalizedSteps.length > 1 && totalDeps === 0) {
          for (let i = 1; i < normalizedSteps.length; i++) {
            normalizedSteps[i] = { ...normalizedSteps[i]!, deps: [normalizedSteps[i - 1]!.stepKey] }
          }
        }

        const warnings: string[] = []
        if (!normalizedSteps.length) warnings.push("No steps in draft.")
        if (!String(normalized.name ?? "").trim()) warnings.push("Missing workflow name.")
        if (!String(normalized.description ?? "").trim()) warnings.push("Missing description.")

        // Best-effort static scan: warn if steps reference ctx.params.<key> but inputSpec doesn't define it.
        const referencedByKey = new Map<string, Set<string>>() // key -> stepKeys
        for (const st of normalizedSteps ?? []) {
          const stepKey = String(st.stepKey ?? "").trim()
          const script = String(st.scriptEsm ?? "")
          if (!stepKey || !script) continue
          for (const k of extractCtxParamsKeys(script)) {
            const set = referencedByKey.get(k) ?? new Set<string>()
            set.add(stepKey)
            referencedByKey.set(k, set)
          }
        }

        if (referencedByKey.size) {
          const inputSpecRaw =
            typeof normalized.inputSpec === "string" && normalized.inputSpec.trim() ? normalized.inputSpec : null
          const parsedInputSpec = inputSpecRaw ? parseWorkflowInputSpec(inputSpecRaw) : { spec: null }
          const props =
            parsedInputSpec.spec &&
            isPlainObject(parsedInputSpec.spec.paramsSchema) &&
            isPlainObject((parsedInputSpec.spec.paramsSchema as Record<string, unknown>).properties)
              ? ((parsedInputSpec.spec.paramsSchema as Record<string, unknown>).properties as Record<string, unknown>)
              : null

          if (!props) {
            warnings.push(
              `Steps reference ctx.params keys (${[...referencedByKey.keys()].join(", ")}), but inputSpec.paramsSchema.properties is empty/missing.`,
            )
          } else {
            for (const [k, stepsSet] of referencedByKey.entries()) {
              if (!(k in props)) {
                warnings.push(`inputSpec missing params key "${k}" referenced by steps: ${[...stepsSet].join(", ")}`)
              }
            }
          }
        }

        const finalDraft = {
          ...normalized,
          steps: normalizedSteps,
          ...(params.shared.generatedInputSpec ? { inputSpec: params.shared.generatedInputSpec } : {}),
          ...(params.shared.generatedOutputsSpec ? { outputsSpec: params.shared.generatedOutputsSpec } : {}),
        }

        params.shared.finalizedDraft = finalDraft as Record<string, unknown>

        return { ok: true, draft: finalDraft, warnings }
      },
    }),

    create_workflow_draft: tool({
      description:
        "Persist the finalized draft as a new workflow. " +
        "The server uses the draft stored by finalize_draft; no arguments required.",
      inputSchema: z.object({}),
      execute: async () => {
        const draft = params.shared.finalizedDraft
        if (!draft) {
          return { ok: false, error: "No finalized draft available. Call finalize_draft first." }
        }

        const parsed = workflowDraftSchema.safeParse(draft)
        if (!parsed.success) {
          return {
            ok: false,
            error: "Stored draft failed validation",
            issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
          }
        }
        const d = parsed.data

        const out = await executeRegisteredToolWithOperation({
          name: "workflow.create",
          input: {
            name: d.name,
            description: d.description,
            dependencies: d.dependencies,
            envJson: d.envJson,
            inputSpec: d.inputSpec ?? null,
            outputsSpec: d.outputsSpec ?? null,
            steps: d.steps,
          },
          ctx: toolCtx,
        })

        const workflow = (out as { workflow?: unknown } | null)?.workflow as
          | { id?: string; publicId?: string; publicNumber?: number; name?: string; description?: string | null }
          | undefined
        const publicId =
          typeof workflow?.publicId === "string"
            ? workflow.publicId
            : typeof workflow?.id === "string"
              ? workflow.id
              : null

        return { ok: true, workflowId: publicId, workflow }
      },
    }),

    update_workflow_draft: tool({
      description:
        "Update an existing workflow from the finalized draft. " +
        "The server uses the draft stored by finalize_draft; only the target workflowId is required.",
      inputSchema: z.object({
        workflowId: z.string().trim().min(1).describe("Public ID of the workflow, e.g. wf-1"),
      }),
      execute: async ({ workflowId }: { workflowId: string }) => {
        const draft = params.shared.finalizedDraft
        if (!draft) {
          return { ok: false, error: "No finalized draft available. Call finalize_draft first." }
        }

        const parsed = workflowDraftSchema.safeParse(draft)
        if (!parsed.success) {
          return {
            ok: false,
            error: "Stored draft failed validation",
            issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
          }
        }
        const d = parsed.data

        const out = await executeRegisteredToolWithOperation({
          name: "workflow.update",
          input: {
            id: String(workflowId).trim(),
            name: d.name,
            description: d.description,
            dependencies: d.dependencies,
            envJson: d.envJson,
            inputSpec: d.inputSpec ?? null,
            outputsSpec: d.outputsSpec ?? null,
            steps: d.steps,
          },
          ctx: toolCtx,
        })

        const workflow = (out as { workflow?: unknown } | null)?.workflow as
          | { id?: string; publicId?: string; publicNumber?: number; name?: string; description?: string | null }
          | undefined
        const publicId =
          typeof workflow?.publicId === "string"
            ? workflow.publicId
            : typeof workflow?.id === "string"
              ? workflow.id
              : null

        return { ok: true, workflowId: publicId, workflow }
      },
    }),

    ...buildRegistryTools(toolCtx),
  }
}

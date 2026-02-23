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
import {
  parseWorkflowInputSpec,
  defaultWorkflowInputSpec,
  extractJsonSchemaObjectShape,
} from "@/lib/shared/maia/input-spec"
import { parseWorkflowOutputsSpec, defaultWorkflowOutputsSpecV1 } from "@/lib/shared/maia/outputs-spec"
import { compileJsonSchema } from "@/lib/server/maia/jsonschema"
import { validateCronExpression } from "@/lib/server/maia/scheduler"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"
import type { ToolExecutionContext } from "@/lib/server/tools/types"
import { canonicalToSdkToolName } from "@/lib/shared/agent/tool-parts"
import { validateWorkflowGraph } from "@/lib/shared/maia/workflow-graph-validation"
import { PLACEHOLDER_SCRIPTS } from "@/lib/server/chat/prompts"

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
  abortSignal?: AbortSignal
}): Promise<string | null> {
  const MAX_ATTEMPTS = 2

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

  const inputSpecTools = {
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
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await generateText({
        model: params.model,
        system: systemPrompt,
        messages: [{ role: "user" as const, content: `Generate inputSpec for this workflow draft:\n${draftContext}` }],
        tools: inputSpecTools,
        stopWhen: stepCountIs(10),
        temperature: 0.2,
        abortSignal: params.abortSignal,
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
    } catch {
      // fall through to retry
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Sub-agent: generate outputsSpec
// ---------------------------------------------------------------------------

export async function generateOutputsSpec(params: {
  draft: Record<string, unknown>
  locale: string
  model: ReturnType<typeof createOpenRouterModel>
  abortSignal?: AbortSignal
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
      abortSignal: params.abortSignal,
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
  abortSignal?: AbortSignal
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
      abortSignal: params.abortSignal,
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

export type LoadedWorkflowSnapshot = {
  name: string
  description: string
  dependencies: string
  envJson: string
  inputSpec: string | null
  outputsSpec: string | null
  steps: Array<Record<string, unknown>>
}

export type OrchestratorSharedState = {
  draftSteps: Array<Record<string, unknown>>
  loadedWorkflow: LoadedWorkflowSnapshot | null
  generatedInputSpec: string | null
  generatedOutputsSpec: string | null
  finalizedDraft: Record<string, unknown> | null
}

type StepEditDiff = {
  kind: "added" | "modified" | "unchanged"
  stepKey: string
  summary: string
  oldLineCount: number
  newLineCount: number
  changedLineCount: number
  isTrivial: boolean
  codeBlock?: string
  markers?: {
    ins: string
    del: string
    collapse: string
  }
}

type DiffOp = { type: "context" | "insert" | "delete"; text: string }

function splitScriptLines(script: string): string[] {
  const normalized = String(script ?? "").replace(/\r\n/g, "\n")
  if (!normalized) return []
  return normalized.split("\n")
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0))
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
    }
  }
  return dp
}

function buildDiffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const dp = buildLcsTable(oldLines, newLines)
  const ops: DiffOp[] = []
  let i = oldLines.length
  let j = newLines.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: "context", text: oldLines[i - 1]! })
      i--
      j--
      continue
    }
    if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ type: "insert", text: newLines[j - 1]! })
      j--
      continue
    }
    if (i > 0) {
      ops.push({ type: "delete", text: oldLines[i - 1]! })
      i--
    }
  }
  ops.reverse()
  return ops
}

function formatLineRanges(lines: number[]): string {
  if (!lines.length) return ""
  const out: string[] = []
  let start = lines[0]!
  let prev = lines[0]!
  for (let i = 1; i < lines.length; i++) {
    const cur = lines[i]!
    if (cur === prev + 1) {
      prev = cur
      continue
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = cur
    prev = cur
  }
  out.push(start === prev ? `${start}` : `${start}-${prev}`)
  return out.join(", ")
}

function buildStepEditDiff(stepKey: string, oldScript: string | null, newScript: string): StepEditDiff {
  const oldText = oldScript == null ? "" : String(oldScript)
  const newText = String(newScript ?? "")
  const oldLines = splitScriptLines(oldText)
  const newLines = splitScriptLines(newText)

  if (oldScript == null) {
    return {
      kind: "added",
      stepKey,
      summary: `Step "${stepKey}" was added.`,
      oldLineCount: 0,
      newLineCount: newLines.length,
      changedLineCount: newLines.length,
      isTrivial: newLines.length <= 2,
    }
  }
  if (oldText === newText) {
    return {
      kind: "unchanged",
      stepKey,
      summary: `Step "${stepKey}" has no code changes.`,
      oldLineCount: oldLines.length,
      newLineCount: newLines.length,
      changedLineCount: 0,
      isTrivial: true,
    }
  }

  // Guardrail: avoid quadratic diff cost for very large scripts.
  if (oldLines.length * newLines.length > 200_000) {
    const approxChanged = Math.abs(newLines.length - oldLines.length)
    return {
      kind: "modified",
      stepKey,
      summary: `Step "${stepKey}" was updated (diff preview omitted for large script).`,
      oldLineCount: oldLines.length,
      newLineCount: newLines.length,
      changedLineCount: approxChanged,
      isTrivial: false,
    }
  }

  const ops = buildDiffOps(oldLines, newLines)
  const changedOpIdx = ops
    .map((op, idx) => ({ op, idx }))
    .filter(({ op }) => op.type !== "context")
    .map(({ idx }) => idx)

  const changedLineCount = changedOpIdx.length
  const isTrivial = changedLineCount <= 2

  const contextRadius = isTrivial ? 6 : 2
  const include = new Set<number>()
  for (const idx of changedOpIdx) {
    const start = Math.max(0, idx - contextRadius)
    const end = Math.min(ops.length - 1, idx + contextRadius)
    for (let i = start; i <= end; i++) include.add(i)
  }

  const rendered: string[] = []
  const insLines: number[] = []
  const delLines: number[] = []
  const collapseLines: number[] = []
  let lineNo = 0
  let inGap = false

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    if (!include.has(i)) {
      if (!inGap) {
        lineNo++
        rendered.push("// ... unchanged lines omitted ...")
        collapseLines.push(lineNo)
        inGap = true
      }
      continue
    }
    inGap = false
    lineNo++
    rendered.push(op.text)
    if (op.type === "insert") insLines.push(lineNo)
    if (op.type === "delete") delLines.push(lineNo)
  }

  const ins = formatLineRanges(insLines)
  const del = formatLineRanges(delLines)
  const collapse = formatLineRanges(collapseLines)
  const headerParts = [`\`\`\`js title="${stepKey}"`]
  if (ins) headerParts.push(`ins={${ins}}`)
  if (del) headerParts.push(`del={${del}}`)
  if (collapse) headerParts.push(`collapse={${collapse}}`)
  const header = headerParts.join(" ")
  const codeBlock = `${header}\n${rendered.join("\n")}\n\`\`\``

  return {
    kind: "modified",
    stepKey,
    summary: `Step "${stepKey}" changed ${changedLineCount} line${changedLineCount === 1 ? "" : "s"}.`,
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
    changedLineCount,
    isTrivial,
    codeBlock,
    markers: { ins, del, collapse },
  }
}

export function buildOrchestratorTools(params: {
  toolCtx: ToolExecutionContext
  model: ReturnType<typeof createOpenRouterModel>
  locale: string
  shared: OrchestratorSharedState
  workflowId?: string
  abortSignal?: AbortSignal
}): ToolSet {
  const { toolCtx } = params
  const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000

  const toLoadedWorkflowSnapshot = (result: unknown): LoadedWorkflowSnapshot | null => {
    const wf = isPlainObject(result) ? (result as Record<string, unknown>).workflow : null
    if (!isPlainObject(wf)) return null
    const w = wf as Record<string, unknown>
    return {
      name: typeof w.name === "string" ? w.name : "",
      description: typeof w.description === "string" ? w.description : "",
      dependencies: typeof w.dependencies === "string" ? w.dependencies : "{}",
      envJson: typeof w.envJson === "string" ? w.envJson : "{}",
      inputSpec: typeof w.inputSpec === "string" && w.inputSpec.trim() ? w.inputSpec : null,
      outputsSpec: typeof w.outputsSpec === "string" && w.outputsSpec.trim() ? w.outputsSpec : null,
      steps: Array.isArray(w.steps)
        ? ((w.steps as unknown[]).filter(isPlainObject) as Array<Record<string, unknown>>)
        : [],
    }
  }

  const loadWorkflowSnapshot = async (workflowId: string): Promise<LoadedWorkflowSnapshot | null> => {
    const result = await executeRegisteredToolWithOperation({
      name: "workflow.get",
      input: { id: workflowId, includeCode: true },
      ctx: toolCtx,
    })
    return toLoadedWorkflowSnapshot(result)
  }

  return {
    load_workflow: tool({
      description:
        "Load an existing workflow by ID (name/description/dependencies/inputSpec/steps with code and deps).",
      inputSchema: z.object({ workflowId: z.string() }),
      execute: async ({ workflowId }: { workflowId: string }) => {
        const result = await executeRegisteredToolWithOperation({
          name: "workflow.get",
          input: { id: workflowId, includeCode: true },
          ctx: toolCtx,
        })
        const snapshot = toLoadedWorkflowSnapshot(result)
        if (snapshot) params.shared.loadedWorkflow = snapshot
        return result
      },
    }),

    create_plan: tool({
      description: "Set the current workflow plan. Replaces any previous plan.",
      inputSchema: z.object({
        title: z.string().describe("Short workflow name"),
        summary: z.string().describe("One-sentence description of what the workflow does"),
        steps: z.array(
          z.object({
            stepKey: z.string().describe("Unique step identifier (e.g. 'fetch_data', 'parse_html')"),
            name: z.string().describe("Short step name (will appear as the step title)"),
            description: z.string().describe("Brief description of what this step does"),
            deps: z.array(z.string()).default([]).describe("Array of stepKey values this step depends on"),
          }),
        ),
      }),
      execute: async ({
        title,
        summary,
        steps,
      }: {
        title: string
        summary: string
        steps: { stepKey: string; name: string; description: string; deps: string[] }[]
      }) => {
        params.shared.draftSteps = []
        params.shared.generatedInputSpec = null
        params.shared.generatedOutputsSpec = null
        params.shared.finalizedDraft = null
        return { ok: true }
      },
    }),

    define_step: tool({
      description:
        "Draft a single workflow step. " + "Re-drafting an existing stepKey replaces the previous version (upsert).",
      inputSchema: z.object({ step: stepSchema }),
      execute: async ({ step }: { step: z.infer<typeof stepSchema> }) => {
        const script = (step.scriptEsm ?? "").trim()
        if (!script) {
          return {
            ok: false,
            error: `step "${step.stepKey}" has an empty scriptEsm. You MUST provide the full script body.`,
          }
        }
        if (!/\bexport\s+default\b/.test(script)) {
          return {
            ok: false,
            error:
              `step "${step.stepKey}" is missing "export default". ` +
              `Every step must have exactly one "export default { async main(env, ctx) { … } }".`,
          }
        }

        const key = String(step.stepKey ?? "").trim()
        const existingDraft = key
          ? (params.shared.draftSteps.find((s) => String(s.stepKey ?? "").trim() === key) ?? null)
          : null
        const loaded = key
          ? (params.shared.loadedWorkflow?.steps.find((s) => String(s.stepKey ?? "").trim() === key) ?? null)
          : null
        let baseline = existingDraft ?? loaded ?? null
        if (!baseline && key && !params.shared.loadedWorkflow && params.workflowId) {
          const snapshot = await loadWorkflowSnapshot(params.workflowId)
          if (snapshot) {
            params.shared.loadedWorkflow = snapshot
            baseline = snapshot.steps.find((s) => String(s.stepKey ?? "").trim() === key) ?? null
          }
        }
        const baselineDeps =
          baseline && Array.isArray((baseline as { deps?: unknown[] }).deps)
            ? ((baseline as { deps?: unknown[] }).deps ?? []).map((d) => String(d ?? "").trim()).filter(Boolean)
            : []
        const normalizedIncomingDeps = (Array.isArray(step.deps) ? step.deps : [])
          .map((d) => String(d ?? "").trim())
          .filter(Boolean)
        const normalizedStep = {
          ...step,
          deps:
            // Edit-mode guardrail: if model omits or empties deps for an existing step,
            // preserve the original DAG edges from baseline.
            params.workflowId && normalizedIncomingDeps.length === 0 && baselineDeps.length > 0
              ? baselineDeps
              : normalizedIncomingDeps,
        }
        const baselineScript = baseline && typeof baseline.scriptEsm === "string" ? baseline.scriptEsm : null
        const editDiff = buildStepEditDiff(key || String(step.stepKey ?? ""), baselineScript, script)
        const idx = key ? params.shared.draftSteps.findIndex((s) => String(s.stepKey ?? "").trim() === key) : -1
        if (idx >= 0) {
          params.shared.draftSteps[idx] = normalizedStep as unknown as Record<string, unknown>
          params.shared.finalizedDraft = null
        } else {
          params.shared.draftSteps.push(normalizedStep as unknown as Record<string, unknown>)
        }
        return { ok: true, editDiff }
      },
    }),

    generate_input_spec: tool({
      description:
        "Generate inputSpec for the workflow draft. " +
        "REQUIRED when any step reads ctx.params. Called after all steps are drafted. " +
        "Automatically retries once on failure.",
      inputSchema: z.object({}),
      execute: async () => {
        const draft = { steps: params.shared.draftSteps } as Record<string, unknown>
        const inputSpec = await generateInputSpec({
          draft,
          locale: params.locale,
          model: params.model,
          abortSignal: params.abortSignal,
        })
        if (!inputSpec) {
          return {
            ok: false,
            error:
              "InputSpec generation failed after retry. " +
              "If steps use ctx.params, validate_draft will reject the draft without a valid inputSpec.",
          }
        }
        params.shared.generatedInputSpec = inputSpec
        return { ok: true, inputSpec }
      },
    }),

    generate_output_spec: tool({
      description:
        "Generate outputsSpec for the workflow draft. " +
        "Optional — only affects structured output display after runs, not execution.",
      inputSchema: z.object({}),
      execute: async () => {
        const draft = { steps: params.shared.draftSteps } as Record<string, unknown>
        const outputsSpec = await generateOutputsSpec({
          draft,
          locale: params.locale,
          model: params.model,
          abortSignal: params.abortSignal,
        })
        if (!outputsSpec) return { ok: false, error: "OutputsSpec generation failed." }
        params.shared.generatedOutputsSpec = outputsSpec
        return { ok: true, outputsSpec }
      },
    }),

    validate_draft: tool({
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
        type UsableInputSpec = { json: string; properties: Record<string, unknown> }
        const toUsableInputSpec = (value: unknown): UsableInputSpec | null => {
          if (typeof value !== "string" || !value.trim()) return null
          const parsed = parseWorkflowInputSpec(value)
          if (!parsed.spec) return null
          const compiled = compileJsonSchema(parsed.spec.paramsSchema)
          if (compiled.compileError) return null
          if (!isPlainObject(parsed.spec.paramsSchema)) return null
          const shape = extractJsonSchemaObjectShape(parsed.spec.paramsSchema)
          if (!shape.properties) return null
          return {
            json: JSON.stringify(parsed.spec, null, 2),
            properties: shape.properties,
          }
        }
        const pickUsableInputSpec = (...values: unknown[]): UsableInputSpec | null => {
          for (const v of values) {
            const usable = toUsableInputSpec(v)
            if (usable) return usable
          }
          return null
        }

        // Edit mode: fill any missing top-level fields from the loaded workflow snapshot
        // so that the AI only needs to pass the fields it wants to change.
        const lw = params.shared.loadedWorkflow
        if (lw) {
          if (!draftCandidate.name || !String(draftCandidate.name).trim()) draftCandidate.name = lw.name
          if (!draftCandidate.description) draftCandidate.description = lw.description
          if (!draftCandidate.dependencies || draftCandidate.dependencies === "{}")
            draftCandidate.dependencies = lw.dependencies
          if (!draftCandidate.envJson || draftCandidate.envJson === "{}") draftCandidate.envJson = lw.envJson
        }

        // Merge steps from three sources (highest priority first):
        //   1. shared.draftSteps — actively define_step'd in this session (has real scripts)
        //   2. shared.loadedWorkflow.steps — loaded via load_workflow (original scripts)
        //   3. input draft steps — may contain placeholder scripts from model-context pruning
        const loadedSteps = lw?.steps ?? []
        if (params.shared.draftSteps.length > 0 || loadedSteps.length > 0) {
          const draftByKey = new Map(params.shared.draftSteps.map((s) => [String(s.stepKey ?? "").trim(), s]))
          const loadedByKey = new Map(
            loadedSteps.map((s) => [String((s as Record<string, unknown>).stepKey ?? "").trim(), s]),
          )
          const inputSteps = Array.isArray(draftCandidate.steps) ? (draftCandidate.steps as unknown[]) : []

          if (inputSteps.length > 0) {
            draftCandidate.steps = inputSteps.map((s) => {
              if (!isPlainObject(s)) return s
              const key = String((s as Record<string, unknown>).stepKey ?? "").trim()
              return draftByKey.get(key) ?? loadedByKey.get(key) ?? s
            })
          } else if (loadedSteps.length > 0) {
            // Edit mode: start from loaded workflow steps and upsert draft changes.
            const merged = loadedSteps.map((s) => {
              const key = String((s as Record<string, unknown>).stepKey ?? "").trim()
              return draftByKey.get(key) ?? s
            })
            const loadedKeys = new Set(
              loadedSteps.map((s) => String((s as Record<string, unknown>).stepKey ?? "").trim()),
            )
            for (const ds of params.shared.draftSteps) {
              const key = String(ds.stepKey ?? "").trim()
              if (key && !loadedKeys.has(key)) merged.push(ds)
            }
            draftCandidate.steps = merged
          } else if (params.shared.draftSteps.length > 0) {
            draftCandidate.steps = params.shared.draftSteps
          }
        }

        // Early detection: reject if any step has a placeholder or empty script.
        // This catches state-loss issues (e.g. stream interruption + pruned persistence)
        // BEFORE the full validation, so the model gets immediate actionable feedback.
        const rawStepsForCheck = Array.isArray(draftCandidate.steps) ? (draftCandidate.steps as unknown[]) : []
        const stepsWithBadScript: string[] = []
        for (const s of rawStepsForCheck) {
          if (!isPlainObject(s)) continue
          const st = s as Record<string, unknown>
          const key = typeof st.stepKey === "string" ? st.stepKey : ""
          const script = typeof st.scriptEsm === "string" ? st.scriptEsm.trim() : ""
          if (!script || PLACEHOLDER_SCRIPTS.has(script)) {
            stepsWithBadScript.push(key || "(unknown)")
          }
        }
        if (stepsWithBadScript.length > 0) {
          return {
            ok: false,
            error:
              "Steps have missing or placeholder scripts — re-define them with define_step before retrying validate_draft.",
            issues: stepsWithBadScript.map((key) => ({
              path: ["steps", key, "scriptEsm"],
              message: `Step "${key}" has no real script. Call define_step for this step first.`,
            })),
          }
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

        const initialUsableInputSpec = pickUsableInputSpec(
          draftCandidate.inputSpec,
          params.shared.generatedInputSpec,
          lw?.inputSpec,
        )
        if (initialUsableInputSpec) {
          draftCandidate.inputSpec = initialUsableInputSpec.json
        }
        if (!draftCandidate.outputsSpec) {
          const fallbackOutputsSpec = params.shared.generatedOutputsSpec ?? lw?.outputsSpec
          if (fallbackOutputsSpec) draftCandidate.outputsSpec = fallbackOutputsSpec
        }

        let parsed = workflowDraftSchema.safeParse(draftCandidate)
        if (!parsed.success) {
          const hasInputSpecIssue = parsed.error.issues.some((i) => i.path.includes("inputSpec"))
          if (hasInputSpecIssue) {
            // Try one deterministic recovery from server-side shared state before dropping inputSpec.
            const recovered = pickUsableInputSpec(params.shared.generatedInputSpec, lw?.inputSpec)
            if (recovered) {
              draftCandidate.inputSpec = recovered.json
              parsed = workflowDraftSchema.safeParse(draftCandidate)
            }
            if (!parsed.success) {
              draftCandidate.inputSpec = ""
              parsed = workflowDraftSchema.safeParse(draftCandidate)
            }
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

        const graphResult = validateWorkflowGraph(normalizedSteps)
        if (!graphResult.ok) {
          const e = graphResult.error
          const sk = e.code !== "CYCLE" ? e.stepKey : ""
          const message =
            e.code === "CYCLE"
              ? `Circular dependency detected: ${e.cycle.join(" → ")}`
              : e.code === "SELF_DEP"
                ? `Step "${sk}" depends on itself`
                : e.code === "DUP_STEP_KEY"
                  ? `Duplicate stepKey "${sk}"`
                  : `Step "${sk}" has unknown dep "${(e as { dep: string }).dep}"`
          return { ok: false, error: "Workflow graph validation failed", issues: [{ path: ["steps"], message }] }
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
          const usableInputSpec = pickUsableInputSpec(
            normalized.inputSpec,
            params.shared.generatedInputSpec,
            lw?.inputSpec,
          )
          const props = usableInputSpec ? usableInputSpec.properties : null

          if (!props) {
            const keys = [...referencedByKey.keys()].join(", ")
            return {
              ok: false,
              error: "inputSpec is required because steps reference ctx.params",
              issues: [
                {
                  path: ["inputSpec"],
                  message: `Steps reference ctx.params keys (${keys}), but inputSpec is missing or has no paramsSchema.properties. Call generate_input_spec first, then retry validate_draft.`,
                },
              ],
            }
          } else {
            const missingKeys: string[] = []
            for (const [k, stepsSet] of referencedByKey.entries()) {
              if (!(k in props)) {
                missingKeys.push(k)
                warnings.push(`inputSpec missing params key "${k}" referenced by steps: ${[...stepsSet].join(", ")}`)
              }
            }
            if (missingKeys.length) {
              return {
                ok: false,
                error: "inputSpec paramsSchema is incomplete",
                issues: [
                  {
                    path: ["inputSpec", "paramsSchema"],
                    message: `inputSpec.paramsSchema.properties is missing keys: ${missingKeys.join(", ")}. Regenerate inputSpec with generate_input_spec, then retry validate_draft.`,
                  },
                ],
              }
            }
          }
        }

        const finalDraft = {
          ...normalized,
          steps: normalizedSteps,
          ...(!normalized.inputSpec ? { inputSpec: params.shared.generatedInputSpec ?? lw?.inputSpec ?? null } : {}),
          ...(!normalized.outputsSpec
            ? { outputsSpec: params.shared.generatedOutputsSpec ?? lw?.outputsSpec ?? null }
            : {}),
        }

        params.shared.finalizedDraft = finalDraft as Record<string, unknown>

        return { ok: true, draft: finalDraft, warnings }
      },
    }),

    create_workflow: tool({
      description:
        "Persist the finalized draft as a new workflow. " +
        "The server uses the draft stored by validate_draft; no arguments required.",
      inputSchema: z.object({}),
      execute: async () => {
        const draft = params.shared.finalizedDraft
        if (!draft) {
          return { ok: false, error: "No finalized draft available. Call validate_draft first." }
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

    update_workflow: tool({
      description:
        "Update an existing workflow from the finalized draft. " +
        "The server uses the draft stored by validate_draft; only the target workflowId is required.",
      inputSchema: z.object({
        workflowId: z.string().trim().min(1).describe("Public ID of the workflow, e.g. wf-1"),
      }),
      execute: async ({ workflowId }: { workflowId: string }) => {
        const draft = params.shared.finalizedDraft
        if (!draft) {
          return { ok: false, error: "No finalized draft available. Call validate_draft first." }
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
  }
}

export function buildSuggestModeSwitchTool(): ToolSet {
  return {
    suggest_mode_switch: tool({
      description:
        "Suggest the user switch to a more appropriate conversation mode when their intent clearly does not match the current mode.",
      inputSchema: z.object({
        target_mode: z.enum(["agent", "chat", "plan"]),
        reason: z.string(),
      }),
    }),
  }
}

export function buildPlanReadyTool(): ToolSet {
  return {
    plan_ready: tool({
      description:
        "Call when a plan-mode discussion has reached consensus and the workflow design is ready to build. Produces a structured summary the user can confirm before switching to Agent mode.",
      inputSchema: z.object({
        title: z.string().describe("Short workflow name"),
        summary: z.string().describe("One-sentence description of what the workflow does"),
        steps: z
          .array(
            z.object({
              stepKey: z.string().describe("Unique step identifier (e.g. 'fetch_data', 'parse_html')"),
              name: z.string().describe("Human-friendly step name in the user's language"),
              deps: z.array(z.string()).default([]).describe("Array of stepKey values this step depends on"),
            }),
          )
          .describe("Structured workflow steps with dependencies"),
        highlights: z.array(z.string()).describe("Key decisions made during planning"),
      }),
    }),
  }
}

export function buildPreviewStepsTool(): ToolSet {
  return {
    preview_steps: tool({
      description:
        "Render workflow step preview nodes on the canvas. Call this whenever you propose or update the workflow structure during discussion. Each call replaces the previous preview.",
      inputSchema: z.object({
        steps: z
          .array(
            z.object({
              stepKey: z.string().describe("Unique step identifier (e.g. 'fetch_data', 'parse_html')"),
              name: z.string().describe("Human-friendly step name in the user's language"),
              deps: z.array(z.string()).default([]).describe("Array of stepKey values this step depends on"),
            }),
          )
          .min(1),
      }),
      execute: async () => ({ ok: true }),
    }),
  }
}

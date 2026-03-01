import "server-only"

import { z } from "zod"
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  tool,
  type UIMessage,
  type ToolSet,
} from "ai"

import { createOpenRouterModel } from "@/lib/server/agent/openrouter"
import { getModelMaxOutputTokens, resolveAiModelAlias } from "@/lib/server/agent/models"
import { getAgentSettingsForUser } from "@/lib/server/maia/agent-settings"
import { requireRequestAuth } from "@/lib/server/authz"
import {
  ensureChat,
  saveChat,
  generateChatTitle,
  updateChatTitle,
  generateChatDescription,
  updateChatDescription,
} from "@/lib/server/chat/persistence"
import { listRegisteredTools } from "@/lib/server/tools/registry"
import { executeRegisteredToolWithOperation } from "@/lib/server/tools/executor"
import { isToolUIPart, getToolName } from "ai"
import type { ToolPart } from "@/lib/shared/agent/tool-parts"
import type { ToolExecutionContext } from "@/lib/server/tools/types"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { prisma } from "@/lib/server/db"
import {
  buildAgentSystemPrompt,
  buildChatSystemPrompt,
  buildPlanSystemPrompt,
  PLACEHOLDER_SCRIPTS,
} from "@/lib/server/chat/prompts"
import {
  buildOrchestratorTools,
  buildRegistryTools,
  buildSuggestModeSwitchTool,
  buildPlanReadyTool,
  buildPreviewStepsTool,
  type OrchestratorSharedState,
} from "@/lib/server/chat/tools"
import { isRecord } from "@/lib/shared/lang/is-record"
import { withApiObservability } from "@/lib/server/observability"
import { OrchestratorPhaseTracker } from "@/lib/server/chat/orchestrator-phase"
import { readBlobToBuffer } from "@/lib/server/maia/input-blobs"
import crypto from "node:crypto"
import { getSettingsEncryptionKeyBytes } from "@/lib/server/settings/crypto"

export const runtime = "nodejs"
export const maxDuration = 300

// ---------------------------------------------------------------------------
// Payload pruning — strip large fields before sending to the model
// ---------------------------------------------------------------------------

const PRUNE_SCRIPT_PLACEHOLDER = "[omitted from model context]"

function absolutizeFileUrls(messages: UIMessage[], requestUrl: string): UIMessage[] {
  return messages.map((msg) => ({
    ...msg,
    parts: msg.parts.map((part) => {
      if (part.type !== "file") return part
      const rawUrl = String((part as { url?: unknown }).url ?? "").trim()
      if (!rawUrl) return part
      try {
        const absolute = new URL(rawUrl, requestUrl).toString()
        return { ...part, url: absolute }
      } catch {
        return part
      }
    }),
  }))
}

function prunePayloadsForModel(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => ({
    ...msg,
    parts: msg.parts.map((part) => {
      if (!isToolUIPart(part)) return part
      const toolName = getToolName(part)
      const p = part as unknown as ToolPart & Record<string, unknown>

      if (toolName === "load_workflow" && isRecord(p.output)) {
        const out = p.output as Record<string, unknown>
        const wf = isRecord(out.workflow) ? (out.workflow as Record<string, unknown>) : null
        const steps = wf && Array.isArray(wf.steps) ? wf.steps : null
        if (wf && steps) {
          const prunedSteps = steps.map((s) => {
            if (!isRecord(s)) return s
            const st = s as Record<string, unknown>
            if (typeof st.scriptEsm === "string" && st.scriptEsm) return { ...st, scriptEsm: PRUNE_SCRIPT_PLACEHOLDER }
            return st
          })
          return { ...p, output: { ...out, workflow: { ...wf, steps: prunedSteps } } } as typeof part
        }
      }

      if (toolName === "define_step" && isRecord(p.input)) {
        const inp = p.input as Record<string, unknown>
        const step = isRecord(inp.step) ? (inp.step as Record<string, unknown>) : null
        const out = isRecord(p.output) ? (p.output as Record<string, unknown>) : null
        const outEdit = out && isRecord(out.editDiff) ? (out.editDiff as Record<string, unknown>) : null
        const prunedOut =
          out && outEdit
            ? {
                ...out,
                editDiff: {
                  ...outEdit,
                  codeBlock:
                    typeof outEdit.codeBlock === "string" && outEdit.codeBlock
                      ? "[omitted from model context]"
                      : outEdit.codeBlock,
                },
              }
            : out
        if (step && typeof step.scriptEsm === "string" && step.scriptEsm) {
          return {
            ...p,
            input: { ...inp, step: { ...step, scriptEsm: PRUNE_SCRIPT_PLACEHOLDER } },
            ...(prunedOut ? { output: prunedOut } : {}),
          } as typeof part
        }
        if (prunedOut) {
          return { ...p, output: prunedOut } as typeof part
        }
      }

      if (toolName === "validate_draft") {
        const pruneDraft = (draft: Record<string, unknown>) => {
          const steps = Array.isArray(draft.steps) ? draft.steps : []
          const prunedSteps = steps.map((s) => {
            if (!isRecord(s)) return s
            const st = s as Record<string, unknown>
            if (typeof st.scriptEsm === "string" && st.scriptEsm) return { ...st, scriptEsm: PRUNE_SCRIPT_PLACEHOLDER }
            return st
          })
          return { ...draft, steps: prunedSteps }
        }

        if (isRecord(p.input)) {
          const inp = p.input as Record<string, unknown>
          if (isRecord(inp.draft)) {
            return { ...p, input: { ...inp, draft: pruneDraft(inp.draft as Record<string, unknown>) } } as typeof part
          }
        }
        if (isRecord(p.output)) {
          const out = p.output as Record<string, unknown>
          if (isRecord(out.draft)) {
            return { ...p, output: { ...out, draft: pruneDraft(out.draft as Record<string, unknown>) } } as typeof part
          }
        }
      }

      return part
    }),
  }))
}

// ---------------------------------------------------------------------------
// Orchestrator state snapshot — injected into system prompt (agent mode only)
// ---------------------------------------------------------------------------

function buildOrchestratorStateSnapshot(messages: UIMessage[]): string {
  type Plan = { title?: string | null; steps?: Array<{ name?: string; description?: string }> }

  let lastPlan: Plan | null = null
  const draftStepKeys: string[] = []
  const stepsWithScript: Set<string> = new Set()
  const stepsMissingScript: Set<string> = new Set()
  const incompleteToolCalls: string[] = []
  let inputSpecOk: boolean | null = null
  let outputsSpecOk: boolean | null = null
  let finalizeOk: boolean | null = null
  let savedWorkflowId: string | null = null

  const seenStep = new Set<string>()

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (!isToolUIPart(part)) continue
      const toolName = getToolName(part)
      const p = part as unknown as ToolPart & Record<string, unknown>

      // Detect incomplete tool calls (stream interrupted before result)
      if (part.state === "input-available" || part.state === "input-streaming") {
        incompleteToolCalls.push(toolName)
      }

      if (toolName === "create_plan" && isRecord(p.input)) {
        lastPlan = p.input as Plan
      }

      if (toolName === "plan_ready" && !lastPlan && isRecord(p.input)) {
        const inp = p.input as Record<string, unknown>
        const rawSteps = Array.isArray(inp.steps) ? inp.steps : []
        if (rawSteps.length > 0) {
          lastPlan = {
            title: typeof inp.title === "string" ? inp.title : null,
            steps: rawSteps.map((s: unknown) => {
              if (typeof s === "string") return { name: s, description: "" }
              if (isRecord(s)) {
                const st = s as Record<string, unknown>
                return {
                  name: typeof st.name === "string" ? st.name : typeof st.stepKey === "string" ? st.stepKey : String(s),
                  description: typeof st.description === "string" ? st.description : "",
                }
              }
              return { name: String(s), description: "" }
            }),
          }
        }
      }

      if (toolName === "define_step" && isRecord(p.input)) {
        const inp = p.input as Record<string, unknown>
        const step = isRecord(inp.step) ? (inp.step as Record<string, unknown>) : null
        const key = step && typeof step.stepKey === "string" ? String(step.stepKey).trim() : ""
        if (key && !seenStep.has(key)) {
          seenStep.add(key)
          draftStepKeys.push(key)
        }
        // Track whether each step has a real script or just a placeholder
        if (key && step && part.state === "output-available") {
          const script = typeof step.scriptEsm === "string" ? step.scriptEsm.trim() : ""
          if (script && !PLACEHOLDER_SCRIPTS.has(script)) {
            stepsWithScript.add(key)
            stepsMissingScript.delete(key)
          } else {
            if (!stepsWithScript.has(key)) stepsMissingScript.add(key)
          }
        }
      }

      if (toolName === "generate_input_spec" && isRecord(p.output)) {
        const out = p.output as Record<string, unknown>
        inputSpecOk = out.ok === true
      }
      if (toolName === "generate_output_spec" && isRecord(p.output)) {
        const out = p.output as Record<string, unknown>
        outputsSpecOk = out.ok === true
      }
      if (toolName === "validate_draft" && isRecord(p.output)) {
        const out = p.output as Record<string, unknown>
        finalizeOk = out.ok === true
      }
      if ((toolName === "create_workflow" || toolName === "update_workflow") && isRecord(p.output)) {
        const out = p.output as Record<string, unknown>
        if (out.ok === true && typeof out.workflowId === "string") savedWorkflowId = out.workflowId
      }
    }
  }

  const lines: string[] = []
  if (lastPlan?.title) lines.push(`plan.title: ${String(lastPlan.title).trim()}`)
  if (Array.isArray(lastPlan?.steps) && lastPlan!.steps!.length) {
    const stepNames = lastPlan!.steps!.map((s) => String(s?.name ?? "").trim()).filter(Boolean)
    const total = lastPlan!.steps!.length
    lines.push(`plan.steps.count: ${total}`)
    if (stepNames.length) {
      const head = stepNames.slice(0, 8)
      const more = Math.max(0, stepNames.length - head.length)
      lines.push(`plan.steps.head: ${head.join(" → ")}${more ? ` (+${more} more)` : ""}`)
    }
  }
  if (draftStepKeys.length) {
    const total = draftStepKeys.length
    const tail = draftStepKeys.slice(Math.max(0, total - 12))
    const omitted = Math.max(0, total - tail.length)
    lines.push(`draft.steps.count: ${total}`)
    lines.push(`draft.steps.tail: ${tail.join(", ")}${omitted ? ` (+${omitted} omitted)` : ""}`)
  }
  if (stepsMissingScript.size > 0) {
    lines.push(
      `WARNING draft.steps.missingScript: ${[...stepsMissingScript].join(", ")} — these steps must be re-defined with define_step before validate_draft`,
    )
  }
  if (incompleteToolCalls.length > 0) {
    lines.push(
      `WARNING incomplete.toolCalls: ${incompleteToolCalls.join(", ")} — previous call(s) did not complete; retry if needed`,
    )
  }
  if (inputSpecOk != null) lines.push(`inputSpec.ok: ${inputSpecOk ? "true" : "false"}`)
  if (outputsSpecOk != null) lines.push(`outputsSpec.ok: ${outputsSpecOk ? "true" : "false"}`)
  if (finalizeOk != null) lines.push(`finalize.ok: ${finalizeOk ? "true" : "false"}`)
  if (savedWorkflowId) lines.push(`saved.workflowId: ${savedWorkflowId}`)

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Context budget — token-aware safety net
// ---------------------------------------------------------------------------

const MODEL_CONTEXT_BUDGET_TOKENS = 100_000

function estimateTokenCount(data: unknown): number {
  const json = typeof data === "string" ? data : JSON.stringify(data)
  return Math.ceil(json.length / 4)
}

// ---------------------------------------------------------------------------
// Read-only tool filter for Plan mode
// ---------------------------------------------------------------------------

const PLAN_MODE_WRITE_SUFFIXES = [
  "_create",
  "_update",
  "_delete",
  "_cancel",
  "_patch",
  "_pause",
  "_resume",
  "_force_stop",
  "_fanout",
  "_run_now",
  "_deps_install",
  "_version_create_snapshot",
  "_version_restore",
  "_job_create",
  "_retry",
  "_rerun",
  "_restart",
]

function isReadOnlyRegistryTool(toolName: string): boolean {
  return !PLAN_MODE_WRITE_SUFFIXES.some((suffix) => toolName.endsWith(suffix))
}

// Agent mode: only read-only registry tools for reference lookups.
// Write/destructive ops and workflow create/update are handled by orchestrator tools.
const AGENT_MODE_BLOCKED_TOOLS = new Set([
  "workflow_create",
  "workflow_update",
  "workflow_patch",
  "workflow_delete",
  "run_delete",
  "run_cancel",
  "run_force_stop",
  "run_step_retry",
  "run_step_rerun",
  "run_step_restart",
  "job_create",
  "job_delete",
  "job_cancel",
  "job_resume",
  "schedule_create",
  "schedule_patch",
  "schedule_delete",
  "schedule_run_now",
  "batch_create",
  "batch_patch",
  "batch_delete",
  "batch_pause",
  "batch_resume",
  "batch_cancel",
  "batch_fanout",
  "batch_job_create",
  "workflow_deps_install",
  "workflow_version_create_snapshot",
  "workflow_version_restore",
])

function isAgentModeRegistryTool(toolName: string): boolean {
  return !AGENT_MODE_BLOCKED_TOOLS.has(toolName)
}

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  chatId: z.string().min(1),
  messages: z.array(z.any()),
  workflowId: z.string().trim().min(1).optional(),
  locale: z.string().trim().min(2).max(16).default("en"),
  model: z.string().trim().min(1).optional(),
  mode: z.enum(["agent", "chat", "plan"]).default("agent"),
})

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: "INVALID_BODY", issues: e.issues }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      })
    }
    return new Response(JSON.stringify({ error: "INVALID_BODY" }), { status: 400 })
  }

  const { chatId, messages: rawMessages, workflowId, locale, mode } = body
  const originalMessages = absolutizeFileUrls(rawMessages as UIMessage[], req.url)

  const { publicId } = await ensureChat({ chatId, userId: auth.userId, workflowId, model: body.model, mode })

  const settings = await getAgentSettingsForUser(auth.userId, { touchApiKeyLastUsed: true })
  if (!settings.apiKey) {
    return new Response(JSON.stringify({ error: "AGENT_API_KEY_MISSING" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, publicId: true, role: true },
  })
  if (!user) {
    return new Response(JSON.stringify({ error: "USER_NOT_FOUND" }), { status: 401 })
  }

  const firstUserMsg = originalMessages.find((m) => m.role === "user")
  const firstUserText = firstUserMsg?.parts.find(
    (p): p is Extract<typeof p, { type: "text" }> => p.type === "text",
  )?.text
  const isFirstMessage = originalMessages.filter((m) => m.role === "user").length === 1
  let titlePromise: Promise<string> | null = null
  let descriptionPromise: Promise<string> | null = null
  if (isFirstMessage && firstUserText?.trim()) {
    titlePromise = generateChatTitle({ firstUserText: firstUserText.trim(), apiKey: settings.apiKey! }).catch(() => "")
    descriptionPromise = generateChatDescription({
      firstUserText: firstUserText.trim(),
      apiKey: settings.apiKey!,
    }).catch(() => "")
  }

  const stream = createUIMessageStream({
    originalMessages,
    execute: async ({ writer }) => {
      const toolCtx: ToolExecutionContext = {
        auth: { userId: user.id, publicId: user.publicId, role: user.role },
        viewerAuth: toViewerAuthContext({ userId: user.id, publicId: user.publicId, role: user.role }),
        actor: `user:${user.publicId}`,
        source: "agent",
        requestId: null,
      }

      const effectiveModel = resolveAiModelAlias(body.model ?? settings.model)
      const openRouterModel = createOpenRouterModel({ apiKey: settings.apiKey!, model: effectiveModel })

      const STREAM_TIMEOUT_MS = Math.max(10_000, Number(process.env.CHAT_STREAM_TIMEOUT_MS) || 290_000)
      const abort = new AbortController()
      const timeout = setTimeout(() => abort.abort(), STREAM_TIMEOUT_MS)
      const onRequestAbort = () => abort.abort()
      req.signal.addEventListener("abort", onRequestAbort, { once: true })

      const isEditing = typeof workflowId === "string" && workflowId.trim().length > 0

      // ── Build system prompt based on mode ──
      let systemPrompt: string
      let tools: ToolSet
      let tracker: OrchestratorPhaseTracker | null = null
      let shared: OrchestratorSharedState | null = null
      let agentRegistryToolNames: string[] = []

      if (mode === "agent") {
        // Detect plan_ready handoff: scan messages for a completed plan_ready tool call.
        let planHandoff: { title: string; summary: string; steps: string[]; highlights: string[] } | null = null
        for (const msg of originalMessages) {
          for (const part of msg.parts) {
            if (!isToolUIPart(part)) continue
            if (getToolName(part) !== "plan_ready") continue
            if (part.state !== "output-available") continue
            const input = part.input as Record<string, unknown> | undefined
            if (!input) continue
            const title = typeof input.title === "string" ? input.title : ""
            const summary = typeof input.summary === "string" ? input.summary : ""
            const rawSteps = Array.isArray(input.steps) ? input.steps : []
            const steps: string[] = rawSteps.map((s: unknown) => {
              if (typeof s === "string") return s
              if (isRecord(s)) {
                const st = s as Record<string, unknown>
                const name = typeof st.name === "string" ? st.name : ""
                const stepKey = typeof st.stepKey === "string" ? st.stepKey : ""
                return name || stepKey || JSON.stringify(s)
              }
              return String(s)
            })
            const highlights = Array.isArray(input.highlights) ? (input.highlights as string[]).map(String) : []
            if (title || steps.length > 0) {
              planHandoff = { title, summary, steps, highlights }
            }
          }
        }

        systemPrompt = buildAgentSystemPrompt({ locale, workflowId, planHandoff })
        const snap = buildOrchestratorStateSnapshot(originalMessages)
        if (snap) systemPrompt += `\n\n[STATE SNAPSHOT]\n${snap}`

        shared = {
          draftSteps: [],
          loadedWorkflow: null,
          generatedInputSpec: null,
          generatedOutputsSpec: null,
          finalizedDraft: null,
        }

        // Reconstruct shared draft state from previous messages so that
        // continuations (e.g. after a stream interruption) can pick up where
        // the previous request left off without losing step scripts.
        for (const msg of originalMessages) {
          for (const part of msg.parts) {
            if (!isToolUIPart(part) || part.state !== "output-available") continue
            const tn = getToolName(part)
            if (tn === "define_step" && isRecord(part.input)) {
              const inp = part.input as Record<string, unknown>
              const step = isRecord(inp.step) ? (inp.step as Record<string, unknown>) : null
              const key = step && typeof step.stepKey === "string" ? step.stepKey.trim() : ""
              if (
                key &&
                step &&
                typeof step.scriptEsm === "string" &&
                step.scriptEsm !== "[saved to workflow]" &&
                step.scriptEsm !== "[omitted from model context]"
              ) {
                const idx = shared.draftSteps.findIndex((s) => String(s.stepKey ?? "").trim() === key)
                if (idx >= 0) {
                  shared.draftSteps[idx] = step as unknown as Record<string, unknown>
                } else {
                  shared.draftSteps.push(step as unknown as Record<string, unknown>)
                }
              }
            }
            if (tn === "generate_input_spec") {
              const out = isRecord(part.output) ? (part.output as Record<string, unknown>) : null
              if (out?.ok === true && typeof out.inputSpec === "string") {
                shared.generatedInputSpec = out.inputSpec
              }
            }
            if (tn === "generate_output_spec") {
              const out = isRecord(part.output) ? (part.output as Record<string, unknown>) : null
              if (out?.ok === true && typeof out.outputsSpec === "string") {
                shared.generatedOutputsSpec = out.outputsSpec
              }
            }
          }
        }

        tracker = new OrchestratorPhaseTracker({ isEditing, skipPlan: !!planHandoff })

        const orchTools = buildOrchestratorTools({
          toolCtx,
          model: openRouterModel,
          locale,
          shared,
          workflowId,
          abortSignal: abort.signal,
        })

        if (planHandoff) {
          delete orchTools.create_plan
        }

        // Agent mode: orchestrator tools + filtered read-only registry tools for reference
        const agentRegistered = listRegisteredTools().filter((t) => !t.internalOnly)
        const agentRegistryTools: ToolSet = {}
        for (const t of agentRegistered) {
          if (!isAgentModeRegistryTool(t.name)) continue
          const aiName = t.name
          if (aiName in orchTools) continue
          agentRegistryToolNames.push(aiName)
          agentRegistryTools[aiName] = tool({
            description: t.description,
            inputSchema: t.inputSchema,
            execute: async (input: unknown) =>
              executeRegisteredToolWithOperation({ name: t.name, input, ctx: toolCtx }),
          })
        }

        tools = {
          ...orchTools,
          ...agentRegistryTools,
          ...buildSuggestModeSwitchTool(),
        }
      } else if (mode === "chat") {
        systemPrompt = buildChatSystemPrompt({ locale })
        const chatRegistry = buildRegistryTools(toolCtx)
        // Chat mode should not have workflow create/update — those must go through Agent orchestrator
        delete chatRegistry["workflow_create"]
        delete chatRegistry["workflow_update"]
        tools = {
          ...chatRegistry,
          ...buildSuggestModeSwitchTool(),
        }
      } else {
        // plan mode — read-only registry tools only
        systemPrompt = buildPlanSystemPrompt({ locale })
        const allRegistered = listRegisteredTools().filter((t) => !t.internalOnly)
        const readOnlyTools: ToolSet = {}
        for (const t of allRegistered) {
          if (!isReadOnlyRegistryTool(t.name)) continue
          const aiName = t.name
          readOnlyTools[aiName] = tool({
            description: t.description,
            inputSchema: t.inputSchema,
            execute: async (input: unknown) =>
              executeRegisteredToolWithOperation({ name: t.name, input, ctx: toolCtx }),
          })
        }
        tools = {
          ...readOnlyTools,
          ...buildSuggestModeSwitchTool(),
          ...buildPlanReadyTool(),
          ...buildPreviewStepsTool(),
        }
      }

      // ── Prune messages ──
      const prunedUI = prunePayloadsForModel(originalMessages)
      const rawModelMessages = await convertToModelMessages(prunedUI, {
        ignoreIncompleteToolCalls: true,
      })

      const prunedModel =
        mode === "agent"
          ? pruneMessages({
              messages: rawModelMessages,
              toolCalls: [
                { type: "before-last-message", tools: ["define_step", "validate_draft"] },
                { type: "before-last-2-messages", tools: ["load_workflow"] },
              ],
              emptyMessages: "remove",
            })
          : pruneMessages({
              messages: rawModelMessages,
              toolCalls: "before-last-2-messages",
              emptyMessages: "remove",
            })

      let modelMessages = prunedModel
      while (modelMessages.length > 2 && estimateTokenCount(modelMessages) > MODEL_CONTEXT_BUDGET_TOKENS) {
        modelMessages = modelMessages.slice(1)
      }

      const streamOpts: Parameters<typeof streamText>[0] = {
        model: openRouterModel,
        system: systemPrompt,
        messages: modelMessages,
        tools,
        maxOutputTokens: getModelMaxOutputTokens(effectiveModel),
        temperature: 0.2,
        experimental_download: async (downloads) => {
          const sign = (sha256: string) =>
            crypto
              .createHmac("sha256", getSettingsEncryptionKeyBytes())
              .update(`user:${auth.userId}|sha:${String(sha256 || "").toLowerCase()}`, "utf8")
              .digest("base64url")

          const out: Array<{ data: Uint8Array; mediaType: string | undefined } | null> = []
          for (const d of downloads) {
            const u = d.url
            const m = u.pathname.match(/\/api\/chats\/[^/]+\/attachments\/([a-f0-9]{64})/i)
            if (!m) {
              out.push(null)
              continue
            }
            const sha256 = String(m[1] || "").toLowerCase()
            const sig = u.searchParams.get("sig") ?? ""
            if (!sig || sig !== sign(sha256)) {
              out.push(null)
              continue
            }
            let buf: Buffer
            try {
              buf = await readBlobToBuffer(sha256)
            } catch {
              out.push(null)
              continue
            }
            const mt = u.searchParams.get("mime") ?? undefined
            out.push({ data: new Uint8Array(buf), mediaType: mt || undefined })
          }
          return out
        },
        abortSignal: abort.signal,
        onFinish: () => {
          clearTimeout(timeout)
          req.signal.removeEventListener("abort", onRequestAbort)
        },
      }

      // Agent mode: use tracker for step gating and terminal detection
      if (mode === "agent" && tracker) {
        streamOpts.stopWhen = [stepCountIs(64), () => tracker!.terminal]
        streamOpts.prepareStep = async () => {
          const orchActive = tracker!.activeTools()
          return { activeTools: [...orchActive, ...agentRegistryToolNames] }
        }
        streamOpts.onStepFinish = ({ toolResults }) => tracker!.processToolResults(toolResults)
      } else {
        streamOpts.stopWhen = stepCountIs(64)
      }

      const result = streamText(streamOpts)

      // Filter out no-op mode switch suggestions (target_mode === current mode).
      // These are confusing and can cause the UI to show a redundant switch card.
      const uiStream = result.toUIMessageStream()
      const reader = uiStream.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const v = value as unknown as Record<string, unknown> | null
        const type = v && typeof v === "object" ? (v as any).type : null
        if (type === "tool-suggest_mode_switch") {
          const input = (v as any).input as Record<string, unknown> | undefined
          const target = typeof input?.target_mode === "string" ? input.target_mode : ""
          if (target && target === mode) continue
        }
        writer.write(value as any)
      }

      if (titlePromise) {
        const title = await titlePromise
        if (title) {
          writer.write({ type: "data-chat-title", data: title })
          void updateChatTitle(chatId, title).catch(() => {})
        }
      }

      if (descriptionPromise) {
        const description = await descriptionPromise
        if (description) {
          writer.write({ type: "data-chat-description", data: description })
          void updateChatDescription(chatId, description).catch(() => {})
        }
      }
    },
    onFinish: async ({ messages: finalMessages }) => {
      await saveChat({
        chatId,
        userId: auth.userId,
        messages: finalMessages,
        workflowId,
        model: body.model,
      })
      await prisma.chat.updateMany({ where: { id: chatId }, data: { agentMode: mode } }).catch(() => {})
    },
  })

  return createUIMessageStreamResponse({
    headers: {
      "X-Maia-Chat-Public-Id": publicId,
    },
    stream,
  })
})

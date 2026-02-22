import "server-only"

import { z } from "zod"
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type ToolSet,
} from "ai"

import { createOpenRouterModel } from "@/lib/server/agent/openrouter"
import { getModelMaxOutputTokens, resolveAiModelAlias } from "@/lib/server/agent/models"
import { getAgentSettingsForUser } from "@/lib/server/maia/agent-settings"
import { requireRequestAuth } from "@/lib/server/authz"
import { ensureChat, saveChat } from "@/lib/server/chat/persistence"
import { listRegisteredTools } from "@/lib/server/tools/registry"
import { isToolUIPart, getToolName } from "ai"
import { canonicalToSdkToolName, type ToolPart } from "@/lib/shared/agent/tool-parts"
import type { ToolExecutionContext } from "@/lib/server/tools/types"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { prisma } from "@/lib/server/db"
import { buildUnifiedSystemPrompt } from "@/lib/server/chat/prompts"
import { buildOrchestratorTools, type OrchestratorSharedState } from "@/lib/server/chat/tools"
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

      if (toolName === "get_workflow" && isRecord(p.output)) {
        const out = p.output as Record<string, unknown>
        const data = isRecord(out.data) ? (out.data as Record<string, unknown>) : null
        const steps = data && Array.isArray(data.steps) ? data.steps : null
        if (data && steps) {
          const prunedSteps = steps.map((s) => {
            if (!isRecord(s)) return s
            const st = s as Record<string, unknown>
            if (typeof st.scriptEsm === "string" && st.scriptEsm) return { ...st, scriptEsm: PRUNE_SCRIPT_PLACEHOLDER }
            return st
          })
          return { ...p, output: { ...out, data: { ...data, steps: prunedSteps } } } as typeof part
        }
      }

      if (toolName === "draft_step" && isRecord(p.input)) {
        const inp = p.input as Record<string, unknown>
        const step = isRecord(inp.step) ? (inp.step as Record<string, unknown>) : null
        if (step && typeof step.scriptEsm === "string" && step.scriptEsm) {
          return {
            ...p,
            input: { ...inp, step: { ...step, scriptEsm: PRUNE_SCRIPT_PLACEHOLDER } },
          } as typeof part
        }
      }

      if (toolName === "finalize_draft") {
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
// Orchestrator state snapshot — injected into system prompt
// ---------------------------------------------------------------------------

function buildOrchestratorStateSnapshot(messages: UIMessage[]): string {
  type Plan = { title?: string | null; steps?: Array<{ name?: string; description?: string }> }

  let lastPlan: Plan | null = null
  const draftStepKeys: string[] = []
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

      if (toolName === "set_plan" && isRecord(p.input)) {
        lastPlan = p.input as Plan
      }

      if (toolName === "draft_step" && isRecord(p.input)) {
        const inp = p.input as Record<string, unknown>
        const step = isRecord(inp.step) ? (inp.step as Record<string, unknown>) : null
        const key = step && typeof step.stepKey === "string" ? String(step.stepKey).trim() : ""
        if (key && !seenStep.has(key)) {
          seenStep.add(key)
          draftStepKeys.push(key)
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
      if (toolName === "finalize_draft" && isRecord(p.output)) {
        const out = p.output as Record<string, unknown>
        finalizeOk = out.ok === true
      }
      if ((toolName === "create_workflow_draft" || toolName === "update_workflow_draft") && isRecord(p.output)) {
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
// Request schema
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  chatId: z.string().min(1),
  messages: z.array(z.any()),
  workflowId: z.string().trim().min(1).optional(),
  locale: z.string().trim().min(2).max(16).default("en"),
  model: z.string().trim().min(1).optional(),
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

  const { chatId, messages: rawMessages, workflowId, locale } = body
  const originalMessages = absolutizeFileUrls(rawMessages as UIMessage[], req.url)

  const { publicId } = await ensureChat({ chatId, userId: auth.userId, workflowId, model: body.model })

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

  let trackerRef: OrchestratorPhaseTracker | null = null

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

      // Detect initial mode from message history: if the conversation already
      // contains orchestrator tool calls, lock into orchestrator mode.
      const ORCHESTRATOR_TOOL_SET = new Set([
        "set_plan",
        "draft_step",
        "finalize_draft",
        "create_workflow_draft",
        "update_workflow_draft",
        "generate_input_spec",
        "generate_output_spec",
        "get_workflow",
      ])
      const hasOrchestratorHistory = originalMessages.some((msg) =>
        msg.parts.some((part) => isToolUIPart(part) && ORCHESTRATOR_TOOL_SET.has(getToolName(part))),
      )

      const isEditing = typeof workflowId === "string" && workflowId.trim().length > 0
      const initialMode: "undecided" | "orchestrator" | "general" =
        isEditing || hasOrchestratorHistory ? "orchestrator" : "undecided"

      const registryToolNames = listRegisteredTools()
        .filter((t) => !t.internalOnly)
        .map((t) => canonicalToSdkToolName(t.name))

      const tracker = new OrchestratorPhaseTracker({
        isEditing,
        initialMode,
        registryToolNames,
      })
      trackerRef = tracker

      const shared: OrchestratorSharedState = {
        draftSteps: [],
        generatedInputSpec: null,
        generatedOutputsSpec: null,
        finalizedDraft: null,
      }

      // Unified system prompt covers both capabilities; the model decides
      // which tools to use based on user intent.
      let systemPrompt = buildUnifiedSystemPrompt({ locale, workflowId })
      if (initialMode === "orchestrator") {
        const snap = buildOrchestratorStateSnapshot(originalMessages)
        if (snap) systemPrompt += `\n\n[STATE SNAPSHOT]\n${snap}`
      }

      // Register ALL tools (orchestrator + registry); prepareStep controls
      // which subset is active via activeTools.
      const tools: ToolSet = buildOrchestratorTools({
        toolCtx,
        model: openRouterModel,
        locale,
        shared,
        onPlanUpdate: (_title, stepsLen) => tracker.onPlanSet(stepsLen),
        onDraftStep: () => tracker.onStepDrafted(),
      })

      // Layer 1: Strip large payloads (scriptEsm → placeholder) at UIMessage level
      const prunedUI = prunePayloadsForModel(originalMessages)
      const rawModelMessages = await convertToModelMessages(prunedUI)

      // Layer 2: AI SDK standard tool-call pruning
      // When in orchestrator mode (or continuing an orchestrator chat), apply
      // aggressive pruning for large tool payloads; otherwise use lighter pruning.
      const prunedModel =
        initialMode === "orchestrator"
          ? pruneMessages({
              messages: rawModelMessages,
              toolCalls: [
                { type: "before-last-message", tools: ["draft_step", "finalize_draft"] },
                { type: "before-last-2-messages", tools: ["get_workflow"] },
              ],
              emptyMessages: "remove",
            })
          : pruneMessages({
              messages: rawModelMessages,
              toolCalls: "before-last-2-messages",
              emptyMessages: "remove",
            })

      // Layer 3: Token-budget guard — drop oldest messages if still over context budget
      let modelMessages = prunedModel
      while (modelMessages.length > 2 && estimateTokenCount(modelMessages) > MODEL_CONTEXT_BUDGET_TOKENS) {
        modelMessages = modelMessages.slice(1)
      }

      const STREAM_TIMEOUT_MS = Math.max(10_000, Number(process.env.CHAT_STREAM_TIMEOUT_MS) || 290_000)
      const abort = new AbortController()
      const timeout = setTimeout(() => abort.abort(), STREAM_TIMEOUT_MS)
      const onRequestAbort = () => abort.abort()
      req.signal.addEventListener("abort", onRequestAbort, { once: true })

      const result = streamText({
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

          // Our chat attachments are stored in the local blob store and referenced via:
          //   /api/chats/<chatPublicId>/attachments/<sha256>?mime=<...>
          // We resolve these URLs to bytes without doing an HTTP fetch.
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
              // If the blob is missing, pass through; provider may still handle or fail gracefully.
              out.push(null)
              continue
            }
            const mt = u.searchParams.get("mime") ?? undefined
            out.push({ data: new Uint8Array(buf), mediaType: mt || undefined })
          }
          return out
        },
        abortSignal: abort.signal,
        stopWhen: [stepCountIs(64), () => tracker.terminal],
        prepareStep: async () => {
          const at = tracker.activeTools()
          return at ? { activeTools: at } : {}
        },
        onStepFinish: ({ toolResults }) => tracker.processToolResults(toolResults),
        onFinish: () => {
          clearTimeout(timeout)
          req.signal.removeEventListener("abort", onRequestAbort)
        },
      })

      writer.merge(result.toUIMessageStream())
    },
    onFinish: async ({ messages: finalMessages }) => {
      await saveChat({
        chatId,
        userId: auth.userId,
        messages: finalMessages,
        workflowId,
        model: body.model,
      })
      const detectedProfile = trackerRef?.detectedProfileId
      if (detectedProfile) {
        await prisma.chat.updateMany({ where: { id: chatId }, data: { profileId: detectedProfile } }).catch(() => {})
      }
    },
  })

  return createUIMessageStreamResponse({
    headers: {
      "X-Maia-Chat-Public-Id": publicId,
    },
    stream,
  })
})

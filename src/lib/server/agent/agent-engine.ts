import "server-only"

import { AgentRunStatus, AgentRunType } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { ensureSqlitePragmas } from "@/lib/server/db"
import { appendStreamEvent } from "@/lib/server/realtime/store"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { getAgentSettingsForUser } from "@/lib/server/maia/agent-settings"
import { CreateWorkflowAgent } from "@/lib/server/agent/agents/create-workflow-agent"
import { CreateInputSchemaAgent } from "@/lib/server/agent/agents/create-input-schema-agent"
import { CreateOutputsSpecAgent } from "@/lib/server/agent/agents/create-outputs-spec-agent"
import type { AgentSend } from "@/lib/shared/agent/types"
import { storeOperationResponse, setOperationProgress } from "@/lib/server/operations/operations"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"
import type { PlainObject } from "@/lib/shared/types/plain-object"
import { runAgentToEmitter } from "./runner-to-emitter"
import { parseWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"
import { safeJsonParse, safeJsonStringifyOrNullLiteral } from "@/lib/shared/lang/safe-json"

type AgentRunSnapshot = {
  messages?: Array<{ role: "user" | "assistant"; content: string }>
  hasAssistantOutput?: boolean
  plan?: unknown | null
  proposal?: unknown | null
  stages?: unknown | null
  progress?: unknown | null
  draftSteps?: unknown[] | null
  updatedAt?: string
}

function nowIso() {
  return new Date().toISOString()
}

function envPositiveInt(name: string, fallback: number) {
  const raw = process.env[name]
  const n = raw == null ? NaN : Number(String(raw).trim())
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function applyEventToSnapshot(snapshot: AgentRunSnapshot, ev: { event: string; data: unknown }) {
  const next: AgentRunSnapshot = snapshot ? { ...snapshot } : {}
  next.updatedAt = nowIso()

  if (ev.event === "delta") {
    const d = isPlainObject(ev.data) ? (ev.data as PlainObject) : null
    const delta = typeof d?.delta === "string" ? String(d.delta) : ""
    if (delta) {
      next.hasAssistantOutput = true
      const msgs = Array.isArray(next.messages) ? [...next.messages] : []
      const last = msgs.length ? msgs[msgs.length - 1] : null
      if (!last || last.role !== "assistant") msgs.push({ role: "assistant", content: delta })
      else msgs[msgs.length - 1] = { ...last, content: String(last.content ?? "") + delta }
      next.messages = msgs
    }
    return next
  }

  if (ev.event === "plan") {
    next.plan = ev.data ?? null
    return next
  }

  if (ev.event === "proposal") {
    next.proposal = ev.data ?? null
    return next
  }

  if (ev.event === "ui") {
    // Keep UI signals for debugging / light progress UIs. Client is still free to derive richer state.
    next.progress = ev.data ?? null
    return next
  }

  if (ev.event === "draft_step") {
    const d = isPlainObject(ev.data) ? (ev.data as PlainObject) : null
    const step = d?.step
    const arr = Array.isArray(next.draftSteps) ? [...next.draftSteps] : []
    if (step) arr.push(step)
    next.draftSteps = arr
    return next
  }

  return next
}

function readDraftStringFieldFromProposal(proposal: unknown, key: "inputSpec" | "outputsSpec"): string | null {
  if (!isPlainObject(proposal)) return null
  const draft = proposal.draft
  if (!isPlainObject(draft)) return null
  const v = (draft as PlainObject)[key]
  return typeof v === "string" && v.trim() ? String(v).trim() : null
}

export class AgentEngine {
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private running = new Set<string>() // internal AgentRun.id

  start() {
    if (this.timer) return
    const tickMs = Number(process.env.AGENT_ENGINE_TICK_MS ?? 500)
    const safe = Number.isFinite(tickMs) && tickMs > 0 ? tickMs : 500
    this.timer = setInterval(() => {
      void this.tick().catch(() => {})
    }, safe)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      await ensureSqlitePragmas()

      // Claim a small batch; execution is async and tracked in-memory.
      const take = 5
      const queued = await prisma.agentRun.findMany({
        where: { status: AgentRunStatus.QUEUED },
        orderBy: [{ createdAt: "asc" }],
        take,
        select: { id: true },
      })
      if (!queued.length) return

      for (const row of queued) {
        const id = String(row.id)
        if (this.running.has(id)) continue
        // Atomic claim.
        const now = new Date()
        const claim = await prisma.agentRun.updateMany({
          where: { id, status: AgentRunStatus.QUEUED },
          data: {
            status: AgentRunStatus.RUNNING,
            startedAt: now,
            errorCode: null,
            errorMessage: null,
            errorMetaJson: null,
            errorAt: null,
          },
        })
        if (claim.count !== 1) continue
        this.running.add(id)
        void this.executeRun(id).finally(() => {
          this.running.delete(id)
        })
      }
    } finally {
      this.ticking = false
    }
  }

  private async executeRun(agentRunInternalId: string) {
    const run = await prisma.agentRun.findUnique({
      where: { id: agentRunInternalId },
      select: {
        id: true,
        publicId: true,
        type: true,
        workflowId: true,
        inputJson: true,
        snapshotJson: true,
        operationId: true,
        ownerUserId: true,
        createdByUserId: true,
        triggeredByUserId: true,
      },
    })
    if (!run) return

    const publicId = String(run.publicId ?? run.id)
    const topic = makeStreamTopic("agentRun", publicId)
    const actorUserId =
      typeof run.triggeredByUserId === "string"
        ? run.triggeredByUserId
        : typeof run.createdByUserId === "string"
          ? run.createdByUserId
          : typeof run.ownerUserId === "string"
            ? run.ownerUserId
            : null
    if (!actorUserId) throw new Error("AGENT_RUN_USER_MISSING")
    const settings = await getAgentSettingsForUser(actorUserId, { touchApiKeyLastUsed: true })

    const heartbeatMs = envPositiveInt("OPS_OPERATION_HEARTBEAT_MS", 30_000)
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    if (run.operationId) {
      // Keep the operation "active" (updatedAt) while the agent run is executing so ops cleanup
      // doesn't mark it FAILED prematurely. Best-effort; failures should not affect the run.
      heartbeatTimer = setInterval(() => {
        void setOperationProgress({
          operationId: run.operationId!,
          total: null,
          messageKey: "operations.progressMessages.agentRunInProgress",
        }).catch(() => {})
      }, heartbeatMs)
    }

    const baseSnapshot: AgentRunSnapshot = (() => {
      const parsed = safeJsonParse(run.snapshotJson)
      return (isPlainObject(parsed) ? (parsed as AgentRunSnapshot) : {}) ?? {}
    })()

    // Seed messages from inputJson if snapshot doesn't have any.
    const inputParsed = safeJsonParse(run.inputJson)
    const inputObj = isPlainObject(inputParsed) ? (inputParsed as PlainObject) : null
    if (!Array.isArray(baseSnapshot.messages)) {
      const msgs = Array.isArray(inputObj?.messages) ? (inputObj!.messages as unknown[]) : []
      const uiMsgs = msgs
        .map((m) => (isPlainObject(m) ? (m as PlainObject) : null))
        .filter(Boolean)
        .map((m) => ({
          role: m!.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: typeof m!.content === "string" ? String(m!.content) : "",
        }))
        .filter((m) => m.content)
      baseSnapshot.messages = uiMsgs
    }

    // Best-effort progress update.
    if (run.operationId) {
      void setOperationProgress({
        operationId: run.operationId,
        current: 0,
        total: null,
        messageKey: "operations.progressMessages.agentRunStarted",
      }).catch(() => {})
    }

    let snapshot = baseSnapshot
    let lastStreamEventId: number | null = null
    let lastError: { code: string; meta?: unknown } | null = null
    let terminalError: Error | null = null
    let runResult: { ok: boolean; code?: string | null } | null = null
    let lastProposal: unknown = snapshot.proposal ?? null

    const flushSnapshot = async (opts?: { final?: boolean }) => {
      await prisma.agentRun
        .update({
          where: { id: agentRunInternalId },
          data: {
            snapshotJson: safeJsonStringifyOrNullLiteral(snapshot),
            ...(typeof lastStreamEventId === "number" ? { lastEventId: Math.floor(lastStreamEventId) } : {}),
            ...(opts?.final ? { finishedAt: new Date() } : {}),
          },
        })
        .catch(() => {})
    }

    // Throttle snapshot flush (avoid writing on every token).
    let lastFlushAt = 0
    const maybeFlush = async () => {
      const now = Date.now()
      if (now - lastFlushAt < 750) return
      lastFlushAt = now
      await flushSnapshot()
    }

    // AgentSend is synchronous, but we need ordered async persistence.
    // Use a chained promise queue to preserve event ordering deterministically.
    let sendChain: Promise<void> = Promise.resolve()
    const send: AgentSend = (event, data) => {
      const ev = String(event)
      // Update in-memory snapshot/status immediately (important for correctness and for TS flow typing).
      snapshot = applyEventToSnapshot(snapshot, { event: ev, data })
      if (ev === "error") {
        const d = isPlainObject(data) ? (data as PlainObject) : null
        const code = typeof d?.code === "string" ? String(d.code) : "AGENT_RUN_FAILED"
        lastError = { code, meta: d?.meta }
      }
      if (ev === "proposal") {
        lastProposal = data
      }
      // "done" is captured from the runner return value (authoritative).

      // Persist event ordering deterministically.
      sendChain = sendChain.then(async () => {
        const row = await appendStreamEvent({ topic, event: ev, data })
        lastStreamEventId = row.id
        await maybeFlush()
      })
    }

    // ---- Execute by run type ----
    const abort = new AbortController()

    try {
      if (!settings.apiKey) throw new Error("AGENT_API_KEY_MISSING")

      if (run.type === AgentRunType.WORKFLOW_ORCHESTRATE) {
        // Input must match CreateWorkflowAgent.requestSchema.
        const body = CreateWorkflowAgent.requestSchema.parse({
          ...(isPlainObject(inputObj) ? inputObj : {}),
          workflowId:
            run.workflowId ?? (typeof inputObj?.workflowId === "string" ? String(inputObj.workflowId) : undefined),
        })
        await send("meta", { agent: "CreateWorkflowAgent", workflowId: run.workflowId ?? null, model: settings.model })
        runResult = await runAgentToEmitter({
          agent: CreateWorkflowAgent,
          body,
          ctx: {
            locale: typeof body.locale === "string" ? body.locale : "en",
            workflowId: run.workflowId ?? undefined,
            signal: abort.signal,
          },
          settings: { apiKey: settings.apiKey, model: settings.model },
          send,
        })
        // Ensure all enqueued event writes (including terminal `done`) are flushed before finalize.
        await sendChain
      } else if (run.type === AgentRunType.WORKFLOW_INPUTSPEC) {
        const locale = typeof inputObj?.locale === "string" ? String(inputObj.locale) : "en"
        const workflowId =
          typeof run.workflowId === "string"
            ? run.workflowId
            : typeof inputObj?.workflowId === "string"
              ? String(inputObj.workflowId)
              : null
        if (!workflowId) throw new Error("WORKFLOW_ID_REQUIRED")
        const instructions = typeof inputObj?.instructions === "string" ? String(inputObj.instructions) : undefined
        const body = CreateInputSchemaAgent.requestSchema.parse({ workflowId, locale, instructions })
        await send("meta", { agent: "CreateInputSchemaAgent", workflowId, model: settings.model })
        runResult = await runAgentToEmitter({
          agent: CreateInputSchemaAgent,
          body,
          ctx: { locale, workflowId, signal: abort.signal },
          settings: { apiKey: settings.apiKey, model: settings.model },
          send,
        })
        await sendChain
      } else if (run.type === AgentRunType.WORKFLOW_OUTPUTSSPEC) {
        const locale = typeof inputObj?.locale === "string" ? String(inputObj.locale) : "en"
        const workflowId =
          typeof run.workflowId === "string"
            ? run.workflowId
            : typeof inputObj?.workflowId === "string"
              ? String(inputObj.workflowId)
              : null
        if (!workflowId) throw new Error("WORKFLOW_ID_REQUIRED")
        const instructions = typeof inputObj?.instructions === "string" ? String(inputObj.instructions) : undefined
        const body = CreateOutputsSpecAgent.requestSchema.parse({ workflowId, locale, instructions })
        await send("meta", { agent: "CreateOutputsSpecAgent", workflowId, model: settings.model })
        runResult = await runAgentToEmitter({
          agent: CreateOutputsSpecAgent,
          body,
          ctx: { locale, workflowId, signal: abort.signal },
          settings: { apiKey: settings.apiKey, model: settings.model },
          send,
        })
        await sendChain
      } else {
        throw new Error(`UNSUPPORTED_AGENT_RUN_TYPE:${String(run.type)}`)
      }
    } catch (e) {
      terminalError = e instanceof Error ? e : new Error(String(e))
      const msg = terminalError.message
      const looksLikeStableCode =
        !!msg &&
        msg.trim().length <= 160 &&
        // Allow machine codes like AGENT_UPSTREAM_TIMEOUT, AGENT_API_KEY_MISSING, REQUEST_ABORTED, etc.
        /^[A-Z0-9_:.]+$/.test(msg.trim()) &&
        msg.trim() === msg.trim().toUpperCase()
      const code = msg.startsWith("UNSUPPORTED_AGENT_RUN_TYPE") ? msg : looksLikeStableCode ? msg : "AGENT_RUN_FAILED"
      const metaObj = isPlainObject((terminalError as unknown as { meta?: unknown }).meta)
        ? ((terminalError as unknown as { meta?: unknown }).meta as unknown as PlainObject)
        : null
      const meta = {
        ...(looksLikeStableCode ? {} : { detail: msg }),
        ...(metaObj ? { causeMeta: metaObj } : {}),
      }
      lastError = lastError ?? { code, meta }
      try {
        await send("error", { code, meta })
      } catch {}
    }

    // Finalize status.
    const ok = runResult?.ok === true && lastError == null
    const finalStatus = ok ? AgentRunStatus.SUCCEEDED : AgentRunStatus.FAILED
    const finalCode = (lastError?.code ?? runResult?.code ?? (ok ? null : "AGENT_RUN_FAILED")) as string | null
    const finalMeta = lastError?.meta ?? null

    // Auto-apply for weak/no-UI runs.
    if (ok && run.workflowId) {
      if (run.type === AgentRunType.WORKFLOW_INPUTSPEC) {
        const inputSpecStr = readDraftStringFieldFromProposal(lastProposal, "inputSpec")
        if (inputSpecStr) {
          const parsed = parseWorkflowInputSpec(inputSpecStr)
          if (parsed.spec) {
            await prisma.workflow.update({
              where: { publicId: run.workflowId },
              data: { inputSpec: JSON.stringify(parsed.spec, null, 2) },
              select: { id: true },
            })
          }
        }
      } else if (run.type === AgentRunType.WORKFLOW_OUTPUTSSPEC) {
        const outputsSpecStr = readDraftStringFieldFromProposal(lastProposal, "outputsSpec")
        if (outputsSpecStr) {
          const parsed = parseWorkflowOutputsSpec(outputsSpecStr)
          if (parsed.spec) {
            await prisma.workflow.update({
              where: { publicId: run.workflowId },
              data: { outputsSpec: JSON.stringify(parsed.spec, null, 2) },
              select: { id: true },
            })
          }
        }
      }
    }

    await prisma.agentRun
      .update({
        where: { id: agentRunInternalId },
        data: {
          status: finalStatus,
          finishedAt: new Date(),
          errorCode: ok ? null : finalCode,
          errorMessage: ok
            ? null
            : isPlainObject(finalMeta) && typeof (finalMeta as PlainObject).detail === "string"
              ? String((finalMeta as PlainObject).detail)
              : finalCode,
          errorMetaJson: ok ? null : safeJsonStringifyOrNullLiteral(finalMeta),
          errorAt: ok ? null : new Date(),
          snapshotJson: safeJsonStringifyOrNullLiteral(snapshot),
          ...(typeof lastStreamEventId === "number" ? { lastEventId: Math.floor(lastStreamEventId) } : {}),
        },
      })
      .catch(() => {})

    if (run.operationId) {
      const replyOk = ok
        ? { status: 200, body: { ok: true, agentRunId: publicId } }
        : { status: 500, body: { code: finalCode ?? "AGENT_RUN_FAILED", meta: { agentRunId: publicId } } }
      await storeOperationResponse({
        operationId: run.operationId,
        reply: replyOk,
        error: ok
          ? null
          : (() => {
              const wrapper = new Error(finalCode ?? "AGENT_RUN_FAILED")
              if (terminalError) return new Error(wrapper.message, { cause: terminalError })
              // If we don't have a thrown Error, try to use meta.detail as a cause message.
              const m =
                isPlainObject(finalMeta) && typeof (finalMeta as PlainObject).detail === "string"
                  ? String((finalMeta as PlainObject).detail)
                  : ""
              return m.trim() ? new Error(wrapper.message, { cause: new Error(m) }) : wrapper
            })(),
      }).catch(() => {})
      if (ok) {
        void setOperationProgress({
          operationId: run.operationId,
          current: 1,
          total: 1,
          messageKey: "operations.progressMessages.agentRunCompleted",
        }).catch(() => {})
      }
    }

    if (heartbeatTimer) clearInterval(heartbeatTimer)
  }
}

declare global {
  var __maiaAgentEngine: AgentEngine | undefined
  var __maiaAgentEngineToken: symbol | undefined
}

const AGENT_ENGINE_TOKEN = Symbol("maia.agent.engine.module")

export function getAgentEngine() {
  const existing = globalThis.__maiaAgentEngine
  if (existing && globalThis.__maiaAgentEngineToken === AGENT_ENGINE_TOKEN) return existing
  if (existing) {
    try {
      existing.stop()
    } catch {}
  }
  const eng = new AgentEngine()
  eng.start()
  globalThis.__maiaAgentEngine = eng
  globalThis.__maiaAgentEngineToken = AGENT_ENGINE_TOKEN
  return eng
}

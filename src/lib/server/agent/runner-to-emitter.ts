import "server-only"

import { z } from "zod"

import { openrouterStreamOnce } from "@/lib/server/agent/openrouter"
import { readOpenRouterStreamTurn } from "@/lib/server/agent/openrouter-stream-turn"
import type { AgentDefinition, AgentSend, ChatMessage } from "@/lib/shared/agent/types"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"
import type { PlainObject } from "@/lib/shared/types/plain-object"
import { CreateInputSchemaAgent } from "@/lib/server/agent/agents/create-input-schema-agent"
import { CreateOutputsSpecAgent } from "@/lib/server/agent/agents/create-outputs-spec-agent"
import { parseWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"

type ErrorWithMeta = Error & { meta?: unknown }
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }

async function runAgentToTerminal<TBody>(params: {
  agent: AgentDefinition<TBody>
  body: TBody
  ctx: { locale: string; workflowId?: string; signal: AbortSignal }
  settings: { apiKey: string; model: string }
  roundTimeoutMs: number
  idleTimeoutMs: number
}) {
  const history: ChatMessage[] = await params.agent.buildHistory({ body: params.body, ctx: params.ctx })
  const MAX_ROUNDS = 24
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let upstreamAbortCode: string | null = null
    let upstreamAbortMeta: PlainObject | null = null
    const upstreamAbort = new AbortController()
    const onReqAbort = () => {
      upstreamAbortCode = "REQUEST_ABORTED"
      try {
        upstreamAbort.abort()
      } catch {}
    }
    if (params.ctx.signal.aborted) onReqAbort()
    else params.ctx.signal.addEventListener("abort", onReqAbort, { once: true })

    const roundTimeout = setTimeout(() => {
      upstreamAbortCode = "AGENT_UPSTREAM_TIMEOUT"
      upstreamAbortMeta = { round, roundTimeoutMs: params.roundTimeoutMs }
      try {
        upstreamAbort.abort()
      } catch {}
    }, params.roundTimeoutMs)

    const tools = params.agent.getTools ? params.agent.getTools({ phase: "plan" }) : params.agent.tools
    let upstream: ReadableStream<Uint8Array>
    try {
      upstream = await openrouterStreamOnce({
        apiKey: params.settings.apiKey,
        model: params.settings.model,
        messages: history,
        tools,
        signal: upstreamAbort.signal,
      })
    } catch (e) {
      clearTimeout(roundTimeout)
      params.ctx.signal.removeEventListener("abort", onReqAbort)
      if (upstreamAbortCode && upstreamAbortCode !== "REQUEST_ABORTED") {
        const err = new Error(upstreamAbortCode)
        ;(err as ErrorWithMeta).meta = upstreamAbortMeta
        throw err
      }
      throw e
    }

    let turn: Awaited<ReturnType<typeof readOpenRouterStreamTurn>>
    try {
      turn = await readOpenRouterStreamTurn({
        upstream,
        upstreamAbort,
        idleTimeoutMs: params.idleTimeoutMs,
        onIdleTimeout: ({ idleTimeoutMs, idleForMs }) => {
          upstreamAbortCode = "AGENT_IDLE_TIMEOUT"
          upstreamAbortMeta = { round, idleTimeoutMs, idleForMs }
        },
      })
    } catch (e) {
      if (upstreamAbortCode && upstreamAbortCode !== "REQUEST_ABORTED") {
        const err = new Error(upstreamAbortCode)
        ;(err as ErrorWithMeta).meta = upstreamAbortMeta
        throw err
      }
      throw e
    } finally {
      clearTimeout(roundTimeout)
      params.ctx.signal.removeEventListener("abort", onReqAbort)
    }

    if (turn.toolCalls.length) {
      const toolCalls: ToolCall[] = turn.toolCalls
      history.push({ role: "assistant", content: turn.assistantContent, tool_calls: toolCalls })

      for (const tc of toolCalls) {
        const name = String(tc.function.name ?? "")
        const argStr = tc.function.arguments ?? "{}"
        let args: unknown = {}
        try {
          args = JSON.parse(argStr || "{}")
        } catch {
          args = {}
        }
        const result = await params.agent.runTool({ name, args, ctx: params.ctx })
        history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) })
        if (params.agent.isTerminalToolResult?.({ name, result })) {
          return { name, result }
        }
      }
      continue
    }

    if (turn.finishReason === "stop" || turn.finishReason === "length" || turn.finishReason == null) break
  }
  return { name: null, result: null }
}

export async function runAgentToEmitter<TBody>(params: {
  agent: AgentDefinition<TBody>
  body: TBody
  ctx: { locale: string; workflowId?: string; signal: AbortSignal }
  settings: { apiKey: string; model: string }
  send: AgentSend
}): Promise<{ ok: boolean; code?: string | null }> {
  const settings = params.settings
  if (!String(settings.apiKey ?? "").trim()) {
    const err = new Error("AGENT_API_KEY_MISSING")
    throw err
  }

  const UPSTREAM_ROUND_TIMEOUT_MS = Math.max(
    1_000,
    Number(process.env.AGENT_UPSTREAM_ROUND_TIMEOUT_MS ?? 120_000) || 120_000,
  )
  const UPSTREAM_IDLE_TIMEOUT_MS = Math.max(
    1_000,
    Number(process.env.AGENT_UPSTREAM_IDLE_TIMEOUT_MS ?? 30_000) || 30_000,
  )

  const history: ChatMessage[] = await params.agent.buildHistory({ body: params.body, ctx: params.ctx })

  let phase: "plan" | "draft" = "plan"
  let terminal = false
  let hitMaxRounds = false
  let planStepsLen = 0
  let draftedSteps = 0
  let forceFinalizeTools = false
  const MAX_TOOL_ROUNDS = 64

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let upstreamAbortCode: string | null = null
    let upstreamAbortMeta: PlainObject | null = null
    const upstreamAbort = new AbortController()
    const onReqAbort = () => {
      upstreamAbortCode = "REQUEST_ABORTED"
      try {
        upstreamAbort.abort()
      } catch {}
    }
    if (params.ctx.signal.aborted) onReqAbort()
    else params.ctx.signal.addEventListener("abort", onReqAbort, { once: true })

    const roundTimeout = setTimeout(() => {
      upstreamAbortCode = "AGENT_UPSTREAM_TIMEOUT"
      upstreamAbortMeta = { round, roundTimeoutMs: UPSTREAM_ROUND_TIMEOUT_MS }
      try {
        upstreamAbort.abort()
      } catch {}
    }, UPSTREAM_ROUND_TIMEOUT_MS)

    if (round === MAX_TOOL_ROUNDS - 1) hitMaxRounds = true

    const baseTools = params.agent.getTools ? params.agent.getTools({ phase }) : params.agent.tools
    const tools =
      params.agent.id === "CreateWorkflowAgent" && phase === "draft" && forceFinalizeTools
        ? baseTools.filter((t) => {
            const n = t?.function?.name
            return n === "validate_workflow_payload" || n === "ui_signal" || n === "get_workflow"
          })
        : baseTools

    let upstream: ReadableStream<Uint8Array>
    try {
      upstream = await openrouterStreamOnce({
        apiKey: settings.apiKey,
        model: settings.model,
        messages: history,
        tools,
        signal: upstreamAbort.signal,
      })
    } catch (e) {
      clearTimeout(roundTimeout)
      params.ctx.signal.removeEventListener("abort", onReqAbort)
      if (upstreamAbortCode && upstreamAbortCode !== "REQUEST_ABORTED") {
        const err = new Error(upstreamAbortCode)
        ;(err as ErrorWithMeta).meta = upstreamAbortMeta
        throw err
      }
      throw e
    }

    let turn: Awaited<ReturnType<typeof readOpenRouterStreamTurn>>
    try {
      turn = await readOpenRouterStreamTurn({
        upstream,
        upstreamAbort,
        idleTimeoutMs: UPSTREAM_IDLE_TIMEOUT_MS,
        onIdleTimeout: ({ idleTimeoutMs, idleForMs }) => {
          upstreamAbortCode = "AGENT_IDLE_TIMEOUT"
          upstreamAbortMeta = { round, idleTimeoutMs, idleForMs }
        },
        onDelta: async (delta) => {
          await params.send("delta", { delta })
          await params.agent.onDelta?.({ delta, send: params.send })
        },
      })
    } catch (e) {
      if (upstreamAbortCode && upstreamAbortCode !== "REQUEST_ABORTED") {
        const err = new Error(upstreamAbortCode)
        ;(err as ErrorWithMeta).meta = upstreamAbortMeta
        throw err
      }
      throw e
    } finally {
      clearTimeout(roundTimeout)
      params.ctx.signal.removeEventListener("abort", onReqAbort)
    }

    if (turn.toolCalls.length) {
      const toolCalls = turn.toolCalls
      history.push({ role: "assistant", content: turn.assistantContent, tool_calls: toolCalls })

      for (const tc of toolCalls) {
        const name = tc.function?.name as string
        const argStr = tc.function?.arguments ?? "{}"
        let args: unknown = {}
        try {
          args = JSON.parse(argStr || "{}")
        } catch {
          args = {}
        }

        const isWorkflowValidate = params.agent.id === "CreateWorkflowAgent" && name === "validate_workflow_payload"
        if (isWorkflowValidate) await params.send("ui", { ok: true, phase: "validate", state: "start" })

        const result = await params.agent.runTool({ name, args, ctx: params.ctx })
        history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) })

        if (isWorkflowValidate) await params.send("ui", { ok: true, phase: "validate", state: "end" })

        if (params.agent.id === "CreateWorkflowAgent") {
          if (name === "update_plan") {
            const r = isPlainObject(result) ? (result as PlainObject) : null
            const nextLen = Array.isArray(r?.steps) ? (r!.steps as unknown[]).length : 0
            if (nextLen !== planStepsLen) {
              draftedSteps = 0
              forceFinalizeTools = false
            }
            planStepsLen = nextLen
          }
          if (name === "publish_draft_step" && isPlainObject(result) && result.ok === true) {
            draftedSteps += 1
            if (planStepsLen > 0 && draftedSteps >= planStepsLen) forceFinalizeTools = true
          }
          if (name === "ui_signal" && isPlainObject(result) && result.phase === "draft" && result.state === "end") {
            forceFinalizeTools = true
          }
        }

        if (isWorkflowValidate && isPlainObject(result) && result.ok === false) {
          await params.send("error", { code: "WORKFLOW_VALIDATION_FAILED", meta: { tool: name } })
          await params.send("done", { ok: false, code: "WORKFLOW_VALIDATION_FAILED" })
          return { ok: false, code: "WORKFLOW_VALIDATION_FAILED" }
        }

        if (isWorkflowValidate && isPlainObject(result) && result.ok === true && isPlainObject(result.draft)) {
          const draft = result.draft as PlainObject
          const raw = typeof draft.inputSpec === "string" ? String(draft.inputSpec) : ""
          const parsed = raw.trim() ? parseWorkflowInputSpec(raw) : { spec: null }
          const hasValidSpec = !!parsed?.spec
          await params.send("ui", { ok: true, phase: "inputSpec", state: "start" })
          if (hasValidSpec) {
            await params.send("ui", { ok: true, phase: "inputSpec", state: "end" })
          } else {
            try {
              const bodyForSpec = CreateInputSchemaAgent.requestSchema.parse({
                workflowId: params.ctx.workflowId,
                draft: {
                  name: typeof draft.name === "string" ? draft.name : undefined,
                  description: typeof draft.description === "string" ? draft.description : "",
                  dependencies: typeof draft.dependencies === "string" ? draft.dependencies : "{}",
                  inputSpec: raw,
                  steps: Array.isArray(draft.steps) ? draft.steps : [],
                },
                locale: params.ctx.locale,
                instructions:
                  "Infer params from how scripts read input.initialInput. Keep required minimal. Provide 1-3 examples (most common first).",
              })
              const specRun = await runAgentToTerminal({
                agent: CreateInputSchemaAgent,
                body: bodyForSpec,
                ctx: params.ctx,
                settings,
                roundTimeoutMs: UPSTREAM_ROUND_TIMEOUT_MS,
                idleTimeoutMs: UPSTREAM_IDLE_TIMEOUT_MS,
              })
              const r = isPlainObject(specRun.result) ? (specRun.result as PlainObject) : null
              const rDraft = isPlainObject(r?.draft) ? (r!.draft as PlainObject) : null
              const inputSpec = typeof rDraft?.inputSpec === "string" ? String(rDraft.inputSpec).trim() : ""
              if (inputSpec) {
                draft.inputSpec = inputSpec
                await params.send("ui", { ok: true, phase: "inputSpec", state: "end" })
              } else {
                await params.send("error", { code: "INPUT_SPEC_GENERATION_FAILED" })
              }
            } catch (e) {
              await params.send("error", {
                code: "INPUT_SPEC_GENERATION_FAILED",
                meta: { detail: e instanceof Error ? e.message : String(e) },
              })
            }
          }

          const rawOut = typeof draft.outputsSpec === "string" ? String(draft.outputsSpec) : ""
          const parsedOut = rawOut.trim() ? parseWorkflowOutputsSpec(rawOut) : { spec: null }
          const hasValidOutputsSpec = !!parsedOut?.spec
          await params.send("ui", { ok: true, phase: "outputsSpec", state: "start" })
          if (hasValidOutputsSpec) {
            await params.send("ui", { ok: true, phase: "outputsSpec", state: "end" })
          } else {
            try {
              const bodyForSpec = CreateOutputsSpecAgent.requestSchema.parse({
                workflowId: params.ctx.workflowId,
                draft: {
                  name: typeof draft.name === "string" ? draft.name : undefined,
                  description: typeof draft.description === "string" ? draft.description : "",
                  dependencies: typeof draft.dependencies === "string" ? draft.dependencies : "{}",
                  inputSpec: typeof draft.inputSpec === "string" ? String(draft.inputSpec) : "",
                  outputsSpec: rawOut,
                  steps: Array.isArray(draft.steps) ? draft.steps : [],
                },
                locale: params.ctx.locale,
                instructions:
                  "Infer stable named outputs from how later steps produce ctx.upstream.<stepKey>.data.outputs. Prefer 1-5 outputs.",
              })
              const specRun = await runAgentToTerminal({
                agent: CreateOutputsSpecAgent,
                body: bodyForSpec,
                ctx: params.ctx,
                settings,
                roundTimeoutMs: UPSTREAM_ROUND_TIMEOUT_MS,
                idleTimeoutMs: UPSTREAM_IDLE_TIMEOUT_MS,
              })
              const r = isPlainObject(specRun.result) ? (specRun.result as PlainObject) : null
              const rDraft = isPlainObject(r?.draft) ? (r!.draft as PlainObject) : null
              const outputsSpec = typeof rDraft?.outputsSpec === "string" ? String(rDraft.outputsSpec).trim() : ""
              if (outputsSpec) {
                draft.outputsSpec = outputsSpec
                await params.send("ui", { ok: true, phase: "outputsSpec", state: "end" })
              } else {
                await params.send("error", { code: "OUTPUTS_SPEC_GENERATION_FAILED" })
              }
            } catch (e) {
              await params.send("error", {
                code: "OUTPUTS_SPEC_GENERATION_FAILED",
                meta: { detail: e instanceof Error ? e.message : String(e) },
              })
            }
          }
        }

        await params.agent.onToolResult?.({ name, result, send: params.send })
        if (name === "update_plan") phase = "draft"
        if (params.agent.isTerminalToolResult?.({ name, result })) {
          terminal = true
          break
        }
      }

      if (terminal) break
      continue
    }

    if (turn.finishReason === "stop" || turn.finishReason === "length" || turn.finishReason == null) break
  }

  if (hitMaxRounds && !terminal) {
    await params.send("error", { code: "AGENT_MAX_ROUNDS_REACHED", meta: { maxToolRounds: MAX_TOOL_ROUNDS } })
  }

  const ok = !(hitMaxRounds && !terminal)
  await params.send("done", { ok })
  return { ok, code: ok ? null : "AGENT_MAX_ROUNDS_REACHED" }
}

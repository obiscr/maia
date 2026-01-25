import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { getAgentSettingsForUser } from "@/lib/server/maia/agent-settings"
import type { AgentDefinition, AgentSend, ChatMessage } from "@/lib/shared/agent/types"
import { deepseekStreamOnce, type DeepseekUpstreamChunk } from "@/lib/server/agent/deepseek"
import { parseUpstreamSseLines, sseEncode } from "@/lib/shared/agent/sse"
import { CreateInputSchemaAgent } from "@/lib/server/agent/agents/create-input-schema-agent"
import { parseWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { CreateOutputsSpecAgent } from "@/lib/server/agent/agents/create-outputs-spec-agent"
import { parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"
import { fail } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { createTiming, logTiming, toServerTiming } from "@/lib/server/http/timing"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"
import type { PlainObject } from "@/lib/shared/types/plain-object"

type ErrorWithMeta = Error & { meta?: unknown }
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }

function toLocale(s: unknown) {
  const out = String(s ?? "").trim()
  return out || "en"
}

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
      upstream = await deepseekStreamOnce({
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

    const reader = upstream.getReader()
    const decoder = new TextDecoder()
    let carry = ""

    const toolCallsByIndex = new Map<number, { id: string; name: string; args: string }>()
    let finishReason: string | null | undefined = null
    let assistantContent = ""
    let lastUpstreamAt = Date.now()

    const idleCheck = setInterval(() => {
      if (upstreamAbort.signal.aborted) return
      const idleFor = Date.now() - lastUpstreamAt
      if (idleFor > params.idleTimeoutMs) {
        upstreamAbortCode = "AGENT_IDLE_TIMEOUT"
        upstreamAbortMeta = { round, idleTimeoutMs: params.idleTimeoutMs, idleForMs: idleFor }
        try {
          upstreamAbort.abort()
        } catch {}
      }
    }, 250)

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        lastUpstreamAt = Date.now()
        carry += decoder.decode(value, { stream: true })
        const parsed = parseUpstreamSseLines(carry)
        carry = parsed.rest

        for (const ev of parsed.events) {
          if (ev.data === "[DONE]") {
            finishReason = finishReason ?? "stop"
            continue
          }
          let chunk: DeepseekUpstreamChunk | null = null
          try {
            chunk = JSON.parse(ev.data) as DeepseekUpstreamChunk
          } catch {
            continue
          }
          const choice = chunk.choices?.[0]
          if (!choice) continue
          finishReason = choice.finish_reason ?? finishReason
          const delta = choice.delta
          if (!delta) continue
          if (typeof delta.content === "string" && delta.content.length) {
            assistantContent += delta.content
          }
          if (delta.tool_calls?.length) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              const prev = toolCallsByIndex.get(idx)
              const id = tc.id ?? prev?.id ?? `tool_${idx}`
              const name = tc.function?.name ?? prev?.name ?? ""
              const args = (prev?.args ?? "") + (tc.function?.arguments ?? "")
              toolCallsByIndex.set(idx, { id, name, args })
            }
          }
        }
      }
    } catch (e) {
      if (upstreamAbortCode && upstreamAbortCode !== "REQUEST_ABORTED") {
        const err = new Error(upstreamAbortCode)
        ;(err as ErrorWithMeta).meta = upstreamAbortMeta
        throw err
      }
      throw e
    } finally {
      clearInterval(idleCheck)
      clearTimeout(roundTimeout)
      params.ctx.signal.removeEventListener("abort", onReqAbort)
    }

    if (toolCallsByIndex.size) {
      const toolCalls: ToolCall[] = [...toolCallsByIndex.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => ({
          id: v.id,
          type: "function",
          function: { name: v.name, arguments: v.args },
        }))

      history.push({ role: "assistant", content: assistantContent, tool_calls: toolCalls })

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

    if (finishReason === "stop" || finishReason === "length" || finishReason == null) break
  }
  return { name: null, result: null }
}

export async function runAgentSse<TBody>(params: { req: Request; agent: AgentDefinition<TBody> }) {
  const timing = createTiming(`POST /api/agent/${params.agent.id}/stream`)
  const user = await getAuthedUserFromRequest(params.req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  const settings = await getAgentSettingsForUser(user.id, { touchApiKeyLastUsed: true })
  timing.mark("settings")
  if (!settings.apiKey) {
    return fail({
      status: 400,
      code: "AGENT_API_KEY_MISSING",
      meta: { hint: "Open Settings → Agent and set API key" },
    })
  }

  let bodyParsed: TBody
  try {
    bodyParsed = params.agent.requestSchema.parse(await params.req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    }
    return fail({ status: 400, code: "INVALID_BODY" })
  }
  timing.mark("parse")
  const bodyObj = isPlainObject(bodyParsed) ? (bodyParsed as PlainObject) : null
  const locale = toLocale(bodyObj?.locale)
  const workflowId = typeof bodyObj?.workflowId === "string" ? String(bodyObj.workflowId) : undefined

  let sseId = 0

  const stream = new ReadableStream({
    start: async (controller) => {
      const send: AgentSend = (event, data) => controller.enqueue(sseEncode({ id: ++sseId, event, data }))

      const UPSTREAM_ROUND_TIMEOUT_MS = Math.max(
        1_000,
        Number(process.env.AGENT_UPSTREAM_ROUND_TIMEOUT_MS ?? 120_000) || 120_000,
      )
      const UPSTREAM_IDLE_TIMEOUT_MS = Math.max(
        1_000,
        Number(process.env.AGENT_UPSTREAM_IDLE_TIMEOUT_MS ?? 30_000) || 30_000,
      )

      const keepalive = setInterval(() => {
        controller.enqueue(`: keepalive ${Date.now()}\n\n`)
      }, 15000)

      let didClose = false
      const closeOnce = () => {
        if (didClose) return
        didClose = true
        clearInterval(keepalive)
        try {
          controller.close()
        } catch {}
      }

      let didSendDone = false
      const sendDoneOnce = (data: unknown) => {
        if (didSendDone) return
        didSendDone = true
        send("done", data)
      }

      const abort = (reason?: unknown, forcedCode?: string, meta?: PlainObject | null) => {
        const code = forcedCode
          ? forcedCode
          : (() => {
              if (!reason && params.req.signal.aborted) return "REQUEST_ABORTED"
              const msg = reason instanceof Error ? reason.message : String(reason)
              if (!msg) return "AGENT_STREAM_FAILED"
              if (msg.toLowerCase().includes("abort")) return "REQUEST_ABORTED"
              if (msg.startsWith("DeepSeek HTTP")) return "DEEPSEEK_HTTP_ERROR"
              return "AGENT_STREAM_FAILED"
            })()
        if (reason || forcedCode) {
          send("error", {
            code,
            meta: {
              detail: reason instanceof Error ? reason.message : reason != null ? String(reason) : undefined,
              ...meta,
            },
          })
        }
        sendDoneOnce({ ok: false, code })
        closeOnce()
      }

      if (params.req.signal.aborted) return abort()
      params.req.signal.addEventListener("abort", () => abort(), { once: true })

      try {
        const history: ChatMessage[] = await params.agent.buildHistory({
          body: bodyParsed,
          ctx: { locale, workflowId, signal: params.req.signal },
        })
        timing.mark("history")

        send("meta", { agent: params.agent.id, workflowId: workflowId ?? null, model: settings.model })

        let phase: "plan" | "draft" = "plan"
        let terminal = false
        let hitMaxRounds = false
        let planStepsLen = 0
        let draftedSteps = 0
        let forceFinalizeTools = false
        // Hard ceiling to prevent runaway tool-call loops.
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
          if (params.req.signal.aborted) onReqAbort()
          else params.req.signal.addEventListener("abort", onReqAbort, { once: true })

          const roundTimeout = setTimeout(() => {
            upstreamAbortCode = "AGENT_UPSTREAM_TIMEOUT"
            upstreamAbortMeta = { round, roundTimeoutMs: UPSTREAM_ROUND_TIMEOUT_MS }
            try {
              upstreamAbort.abort()
            } catch {}
          }, UPSTREAM_ROUND_TIMEOUT_MS)

          // If we make it to the last round, remember that we hit the ceiling (unless we terminate earlier).
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
            upstream = await deepseekStreamOnce({
              apiKey: settings.apiKey,
              model: settings.model,
              messages: history,
              tools,
              signal: upstreamAbort.signal,
            })
          } catch (e) {
            clearTimeout(roundTimeout)
            params.req.signal.removeEventListener("abort", onReqAbort)
            if (upstreamAbortCode && upstreamAbortCode !== "REQUEST_ABORTED") {
              abort(e, upstreamAbortCode, upstreamAbortMeta)
              return
            }
            throw e
          }
          timing.mark("upstream")

          const reader = upstream.getReader()
          const decoder = new TextDecoder()
          let carry = ""

          const toolCallsByIndex = new Map<number, { id: string; name: string; args: string }>()
          let finishReason: string | null | undefined = null
          let assistantContent = ""
          let lastUpstreamAt = Date.now()
          const bumpUpstream = () => {
            lastUpstreamAt = Date.now()
          }
          const idleCheck = setInterval(() => {
            if (upstreamAbort.signal.aborted) return
            const idleFor = Date.now() - lastUpstreamAt
            if (idleFor > UPSTREAM_IDLE_TIMEOUT_MS) {
              upstreamAbortCode = "AGENT_IDLE_TIMEOUT"
              upstreamAbortMeta = { round, idleTimeoutMs: UPSTREAM_IDLE_TIMEOUT_MS, idleForMs: idleFor }
              try {
                upstreamAbort.abort()
              } catch {}
            }
          }, 250)

          try {
            while (true) {
              const { value, done } = await reader.read()
              if (done) break
              bumpUpstream()
              carry += decoder.decode(value, { stream: true })
              const parsed = parseUpstreamSseLines(carry)
              carry = parsed.rest

              for (const ev of parsed.events) {
                if (ev.data === "[DONE]") {
                  finishReason = finishReason ?? "stop"
                  continue
                }
                let chunk: DeepseekUpstreamChunk | null = null
                try {
                  chunk = JSON.parse(ev.data) as DeepseekUpstreamChunk
                } catch {
                  continue
                }
                const choice = chunk.choices?.[0]
                if (!choice) continue
                finishReason = choice.finish_reason ?? finishReason
                const delta = choice.delta
                if (!delta) continue

                if (typeof delta.content === "string" && delta.content.length) {
                  assistantContent += delta.content
                  send("delta", { delta: delta.content })
                  params.agent.onDelta?.({ delta: delta.content, send })
                }

                if (delta.tool_calls?.length) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0
                    const prev = toolCallsByIndex.get(idx)
                    const id = tc.id ?? prev?.id ?? `tool_${idx}`
                    const name = tc.function?.name ?? prev?.name ?? ""
                    const args = (prev?.args ?? "") + (tc.function?.arguments ?? "")
                    toolCallsByIndex.set(idx, { id, name, args })
                  }
                }
              }
            }
          } catch (e) {
            // If we aborted due to idle/round timeout, surface a clear error and terminate the SSE stream.
            if (upstreamAbortCode && upstreamAbortCode !== "REQUEST_ABORTED") {
              clearInterval(idleCheck)
              abort(e, upstreamAbortCode, upstreamAbortMeta)
              return
            }
            throw e
          } finally {
            clearInterval(idleCheck)
            clearTimeout(roundTimeout)
            params.req.signal.removeEventListener("abort", onReqAbort)
          }

          if (toolCallsByIndex.size) {
            const toolCalls = [...toolCallsByIndex.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([, v]) => ({
                id: v.id,
                type: "function",
                function: { name: v.name, arguments: v.args },
              }))

            history.push({ role: "assistant", content: assistantContent, tool_calls: toolCalls })

            for (const tc of toolCalls) {
              const name = tc.function?.name as string
              const argStr = tc.function?.arguments ?? "{}"
              let args: unknown = {}
              try {
                args = JSON.parse(argStr || "{}")
              } catch {
                args = {}
              }

              // Product semantics: explicitly signal "validating" phase to the UI for workflow draft finalization.
              const isWorkflowValidate =
                params.agent.id === "CreateWorkflowAgent" && name === "validate_workflow_payload"
              if (isWorkflowValidate) send("ui", { ok: true, phase: "validate", state: "start" })
              const result = await params.agent.runTool({
                name,
                args,
                ctx: { locale, workflowId, signal: params.req.signal },
              })
              history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) })
              if (isWorkflowValidate) send("ui", { ok: true, phase: "validate", state: "end" })

              // Orchestrator bookkeeping for CreateWorkflowAgent:
              if (params.agent.id === "CreateWorkflowAgent") {
                if (name === "update_plan") {
                  const r = isPlainObject(result) ? (result as PlainObject) : null
                  const nextLen = Array.isArray(r?.steps) ? r!.steps.length : 0
                  // If the plan changes, reset draft counters; we must draft again for the new plan.
                  if (nextLen !== planStepsLen) {
                    draftedSteps = 0
                    forceFinalizeTools = false
                  }
                  planStepsLen = nextLen
                }
                if (name === "publish_draft_step" && isPlainObject(result) && result.ok === true) {
                  draftedSteps += 1
                  if (planStepsLen > 0 && draftedSteps >= planStepsLen) {
                    forceFinalizeTools = true
                  }
                }
                if (
                  name === "ui_signal" &&
                  isPlainObject(result) &&
                  result.phase === "draft" &&
                  result.state === "end"
                ) {
                  forceFinalizeTools = true
                }
              }

              // Product semantics: validation failure should never lead to infinite pending.
              // If CreateWorkflowAgent validation fails, emit a clear error and end the stream.
              if (isWorkflowValidate && isPlainObject(result) && result.ok === false) {
                const r = result as PlainObject
                send("error", {
                  code: "WORKFLOW_VALIDATION_FAILED",
                  meta: { tool: name, error: r.error, issues: Array.isArray(r.issues) ? r.issues : [] },
                })
                sendDoneOnce({ ok: false, code: "WORKFLOW_VALIDATION_FAILED" })
                closeOnce()
                return
              }

              // Unified stream: after workflow validation succeeds, generate inputSpec (if missing/invalid)
              // within the SAME SSE stream, so UI has a single source of truth and doesn't block on a second request.
              if (isWorkflowValidate && isPlainObject(result) && result.ok === true && isPlainObject(result.draft)) {
                const draft = result.draft as PlainObject
                const raw = typeof draft.inputSpec === "string" ? String(draft.inputSpec) : ""
                const parsed = raw.trim() ? parseWorkflowInputSpec(raw) : { spec: null }
                const hasValidSpec = !!parsed?.spec
                send("ui", { ok: true, phase: "inputSpec", state: "start" })
                if (hasValidSpec) {
                  // Already valid; close immediately.
                  send("ui", { ok: true, phase: "inputSpec", state: "end" })
                } else {
                  try {
                    const bodyForSpec = CreateInputSchemaAgent.requestSchema.parse({
                      workflowId,
                      draft: {
                        name: typeof draft.name === "string" ? draft.name : undefined,
                        description: typeof draft.description === "string" ? draft.description : "",
                        dependencies: typeof draft.dependencies === "string" ? draft.dependencies : "{}",
                        inputSpec: raw,
                        steps: Array.isArray(draft.steps) ? draft.steps : [],
                      },
                      locale,
                      instructions:
                        "Infer params from how scripts read input.initialInput. Keep required minimal. Provide 1-3 examples (most common first).",
                    })
                    const specRun = await runAgentToTerminal({
                      agent: CreateInputSchemaAgent,
                      body: bodyForSpec,
                      ctx: { locale, workflowId, signal: params.req.signal },
                      settings: { apiKey: settings.apiKey, model: settings.model },
                      roundTimeoutMs: UPSTREAM_ROUND_TIMEOUT_MS,
                      idleTimeoutMs: UPSTREAM_IDLE_TIMEOUT_MS,
                    })
                    const r = isPlainObject(specRun.result) ? (specRun.result as PlainObject) : null
                    const rDraft = isPlainObject(r?.draft) ? (r!.draft as PlainObject) : null
                    const inputSpec = typeof rDraft?.inputSpec === "string" ? String(rDraft.inputSpec).trim() : ""
                    if (inputSpec) {
                      draft.inputSpec = inputSpec
                      send("ui", { ok: true, phase: "inputSpec", state: "end" })
                    } else {
                      send("error", { code: "INPUT_SPEC_GENERATION_FAILED" })
                    }
                  } catch (e) {
                    send("error", {
                      code: "INPUT_SPEC_GENERATION_FAILED",
                      meta: { detail: e instanceof Error ? e.message : String(e) },
                    })
                  }
                }

                // Unified stream: after inputSpec, generate outputsSpec (if missing/invalid) within SAME stream.
                const rawOut = typeof draft.outputsSpec === "string" ? String(draft.outputsSpec) : ""
                const parsedOut = rawOut.trim() ? parseWorkflowOutputsSpec(rawOut) : { spec: null }
                const hasValidOutputsSpec = !!parsedOut?.spec
                send("ui", { ok: true, phase: "outputsSpec", state: "start" })
                if (hasValidOutputsSpec) {
                  send("ui", { ok: true, phase: "outputsSpec", state: "end" })
                } else {
                  try {
                    const bodyForSpec = CreateOutputsSpecAgent.requestSchema.parse({
                      workflowId,
                      draft: {
                        name: typeof draft.name === "string" ? draft.name : undefined,
                        description: typeof draft.description === "string" ? draft.description : "",
                        dependencies: typeof draft.dependencies === "string" ? draft.dependencies : "{}",
                        inputSpec: typeof draft.inputSpec === "string" ? String(draft.inputSpec) : "",
                        outputsSpec: rawOut,
                        steps: Array.isArray(draft.steps) ? draft.steps : [],
                      },
                      locale,
                      instructions:
                        "Infer stable named outputs from how later steps produce ctx.upstream.<stepKey>.data.outputs. Prefer 1-5 outputs.",
                    })
                    const specRun = await runAgentToTerminal({
                      agent: CreateOutputsSpecAgent,
                      body: bodyForSpec,
                      ctx: { locale, workflowId, signal: params.req.signal },
                      settings: { apiKey: settings.apiKey, model: settings.model },
                      roundTimeoutMs: UPSTREAM_ROUND_TIMEOUT_MS,
                      idleTimeoutMs: UPSTREAM_IDLE_TIMEOUT_MS,
                    })
                    const r = isPlainObject(specRun.result) ? (specRun.result as PlainObject) : null
                    const rDraft = isPlainObject(r?.draft) ? (r!.draft as PlainObject) : null
                    const outputsSpec = typeof rDraft?.outputsSpec === "string" ? String(rDraft.outputsSpec).trim() : ""
                    if (outputsSpec) {
                      draft.outputsSpec = outputsSpec
                      send("ui", { ok: true, phase: "outputsSpec", state: "end" })
                    } else {
                      send("error", { code: "OUTPUTS_SPEC_GENERATION_FAILED" })
                    }
                  } catch (e) {
                    send("error", {
                      code: "OUTPUTS_SPEC_GENERATION_FAILED",
                      meta: { detail: e instanceof Error ? e.message : String(e) },
                    })
                  }
                }
                // Emit the proposal only after inputSpec generation attempt (single final proposal for the stream).
                params.agent.onToolResult?.({ name, result, send })
              } else {
                params.agent.onToolResult?.({ name, result, send })
              }

              // Orchestrator transition:
              // For CreateWorkflowAgent-style flows, publishing a plan is the hard boundary between plan and draft.
              // This makes it impossible for the model to draft steps before it publishes the plan.
              if (name === "update_plan") phase = "draft"

              // Terminal tool result: stop early and close SSE (prevents extra narration after we already have the final payload).
              if (params.agent.isTerminalToolResult?.({ name, result })) {
                terminal = true
                break
              }
            }

            if (terminal) break
            continue
          }

          if (finishReason === "stop" || finishReason === "length" || finishReason == null) break
        }

        if (hitMaxRounds && !terminal) {
          send("error", { code: "AGENT_MAX_ROUNDS_REACHED", meta: { maxToolRounds: MAX_TOOL_ROUNDS } })
        }
        sendDoneOnce({ ok: !(hitMaxRounds && !terminal) })
        closeOnce()
      } catch (e) {
        abort(e)
      }
    },
  })

  const ended = timing.end()
  logTiming({ label: ended.label, meta: { workflowId: workflowId ?? null }, total: ended.total, marks: ended.marks })
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Server-Timing": toServerTiming({ total: ended.total, marks: ended.marks }),
    },
  })
}

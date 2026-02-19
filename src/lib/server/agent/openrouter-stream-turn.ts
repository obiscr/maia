import "server-only"

import type { OpenRouterUpstreamChunk } from "@/lib/server/agent/openrouter"
import { parseUpstreamSseLines } from "@/lib/shared/agent/sse"

type ToolCallByIndex = { id: string; name: string; args: string }

export type OpenRouterToolCall = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export async function readOpenRouterStreamTurn(params: {
  upstream: ReadableStream<Uint8Array>
  upstreamAbort: AbortController
  idleTimeoutMs: number
  onIdleTimeout: (meta: { idleTimeoutMs: number; idleForMs: number }) => void
  onDelta?: (delta: string) => void | Promise<void>
}) {
  const reader = params.upstream.getReader()
  const decoder = new TextDecoder()
  let carry = ""
  const toolCallsByIndex = new Map<number, ToolCallByIndex>()
  let finishReason: string | null | undefined = null
  let assistantContent = ""
  let lastUpstreamAt = Date.now()

  const idleCheck = setInterval(() => {
    if (params.upstreamAbort.signal.aborted) return
    const idleFor = Date.now() - lastUpstreamAt
    if (idleFor > params.idleTimeoutMs) {
      params.onIdleTimeout({ idleTimeoutMs: params.idleTimeoutMs, idleForMs: idleFor })
      try {
        params.upstreamAbort.abort()
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

        let chunk: OpenRouterUpstreamChunk | null = null
        try {
          chunk = JSON.parse(ev.data) as OpenRouterUpstreamChunk
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
          await params.onDelta?.(delta.content)
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
  } finally {
    clearInterval(idleCheck)
  }

  return {
    assistantContent,
    finishReason,
    toolCalls: [...toolCallsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({
        id: v.id,
        type: "function" as const,
        function: { name: v.name, arguments: v.args },
      })),
  }
}

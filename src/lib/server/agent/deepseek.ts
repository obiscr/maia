import "server-only"

import type { ChatMessage, ToolDef } from "@/lib/shared/agent/types"

export type DeepseekUpstreamDelta = {
  content?: string
  tool_calls?: Array<{
    index?: number
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}

export type DeepseekUpstreamChunk = {
  choices?: Array<{
    delta?: DeepseekUpstreamDelta
    finish_reason?: string | null
  }>
}

export async function deepseekStreamOnce(params: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools: ToolDef[]
  signal: AbortSignal
}) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      tools: params.tools,
      tool_choice: "auto",
      stream: true,
      temperature: 0.2,
    }),
    signal: params.signal,
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new Error(`DeepSeek HTTP ${res.status}: ${txt.slice(0, 500)}`)
  }
  if (!res.body) throw new Error("DeepSeek response missing body")
  return res.body
}

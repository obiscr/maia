import "server-only"

import type { ChatMessage, ToolDef } from "@/lib/shared/agent/types"

export type OpenRouterUpstreamDelta = {
  content?: string
  tool_calls?: Array<{
    index?: number
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}

export type OpenRouterUpstreamChunk = {
  choices?: Array<{
    delta?: OpenRouterUpstreamDelta
    finish_reason?: string | null
  }>
}

export const OPENROUTER_MODELS = [
  { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6", provider: "Anthropic" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic" },
  { id: "openai/gpt-5.2-pro", name: "GPT-5.2 Pro", provider: "OpenAI" },
  { id: "openai/gpt-5.2", name: "GPT-5.2", provider: "OpenAI" },
  { id: "openai/gpt-5.2-chat", name: "GPT-5.2 Chat", provider: "OpenAI" },
  { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex", provider: "OpenAI" },
  { id: "google/gemini-3-pro-preview", name: "Gemini 3 Pro (Preview)", provider: "Google" },
  { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash (Preview)", provider: "Google" },
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5", provider: "Moonshot AI" },
  { id: "deepseek/deepseek-v3.2-speciale", name: "DeepSeek V3.2 Speciale", provider: "DeepSeek" },
  { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", provider: "DeepSeek" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", provider: "DeepSeek" },
  { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick", provider: "Meta" },
  { id: "meta-llama/llama-4-scout", name: "Llama 4 Scout", provider: "Meta" },
  { id: "qwen/qwen3-max", name: "Qwen3 Max", provider: "Qwen" },
  { id: "qwen/qwen3-next-80b-a3b-thinking", name: "Qwen3 Next 80B A3B Thinking", provider: "Qwen" },
  { id: "qwen/qwen3-32b", name: "Qwen3 32B", provider: "Qwen" },
  { id: "mistralai/mistral-large-2512", name: "Mistral Large 3 2512", provider: "Mistral" },
] as const

export type OpenRouterModelId = (typeof OPENROUTER_MODELS)[number]["id"]
export const DEFAULT_OPENROUTER_MODEL: OpenRouterModelId = "openai/gpt-5.2-codex"

export async function openrouterStreamOnce(params: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools: ToolDef[]
  signal: AbortSignal
}) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "Maia",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      tools: params.tools.length > 0 ? params.tools : undefined,
      tool_choice: params.tools.length > 0 ? "auto" : undefined,
      stream: true,
      temperature: 0.2,
    }),
    signal: params.signal,
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new Error(`OpenRouter HTTP ${res.status}: ${txt.slice(0, 500)}`)
  }
  if (!res.body) throw new Error("OpenRouter response missing body")
  return res.body
}

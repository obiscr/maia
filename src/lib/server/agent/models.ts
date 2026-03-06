import "server-only"

import { DEFAULT_CHAT_MODEL } from "@/lib/shared/models"

export const DEFAULT_OPENROUTER_MODEL = DEFAULT_CHAT_MODEL

export const CHAT_TITLE_GENERATION_MODEL = "x-ai/grok-4.1-fast"
export const CRON_GENERATION_MODEL = "x-ai/grok-4.1-fast"

const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "anthropic/claude-opus-4.6": 32768,
  "anthropic/claude-sonnet-4.6": 16384,
  "anthropic/claude-sonnet-4.5": 16384,
  "openai/gpt-5.4": 32768,
  "openai/gpt-5.3-codex": 32768,
  "openai/gpt-5.2-pro": 32768,
  "openai/gpt-5.2": 16384,
  "openai/gpt-5.2-codex": 32768,
  "google/gemini-3.1-pro-preview": 32768,
  "google/gemini-3-flash-preview": 32768,
  "x-ai/grok-4.1-fast": 16384,
  "minimax/minimax-m2.5": 32768,
  "moonshotai/kimi-k2.5": 16384,
  "qwen/qwen3.5-plus-02-15": 32768,
  "deepseek/deepseek-r1-0528": 32768,
}

const DEFAULT_MAX_OUTPUT_TOKENS = 16384

export function getModelMaxOutputTokens(model: string): number {
  const envOverride = process.env.AGENT_MAX_OUTPUT_TOKENS
  if (envOverride != null) {
    const n = Number(String(envOverride).trim())
    if (Number.isFinite(n) && n > 0) return Math.max(256, Math.min(65536, Math.floor(n)))
  }
  const resolved = resolveAiModelAlias(model)
  return MODEL_MAX_OUTPUT_TOKENS[resolved] ?? DEFAULT_MAX_OUTPUT_TOKENS
}

export function resolveAiModelAlias(model: string | null | undefined) {
  const raw = String(model ?? "")
    .trim()
    .toLowerCase()
  if (!raw) return DEFAULT_OPENROUTER_MODEL
  return raw
}

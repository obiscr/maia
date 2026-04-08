import "server-only"

import { DEFAULT_CHAT_MODEL } from "@/lib/shared/models"

export const DEFAULT_OPENROUTER_MODEL = DEFAULT_CHAT_MODEL

export const CHAT_TITLE_GENERATION_MODEL = "x-ai/grok-4.1-fast"
export const CRON_GENERATION_MODEL = "x-ai/grok-4.1-fast"

const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "anthropic/claude-opus-4.7": 32000,
  "anthropic/claude-opus-4.6": 32000,
  "anthropic/claude-opus-4.6-fast": 32000,
  "anthropic/claude-sonnet-4.6": 64000,
  "anthropic/claude-sonnet-4.5": 64000,
  "openai/gpt-5.5-pro": 128000,
  "openai/gpt-5.5": 128000,
  "openai/gpt-5.4-pro": 128000,
  "openai/gpt-5.4": 128000,
  "z-ai/glm-5.1": 131072,
  "google/gemini-3.1-pro-preview": 65536,
  "google/gemini-3-flash-preview": 65536,
  // Keep a conservative cap until xAI publishes a model-specific max output limit.
  "x-ai/grok-4.1-fast": 16384,
  "minimax/minimax-m2.7": 65536,
  // Keep a conservative cap until Moonshot publishes a model-specific max output limit.
  "moonshotai/kimi-k2.6": 16384,
  "qwen/qwen3.6-plus": 65536,
  "deepseek/deepseek-v4-pro": 384000,
  "deepseek/deepseek-v4-flash": 384000,
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

import "server-only"

import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { resolveAiModelAlias } from "@/lib/server/agent/models"
import { AVAILABLE_MODELS, DEFAULT_CHAT_MODEL } from "@/lib/shared/models"

export const OPENROUTER_MODELS = AVAILABLE_MODELS

export type OpenRouterModelId = (typeof AVAILABLE_MODELS)[number]["id"]
export const OPENROUTER_DEFAULT_MODEL: string = DEFAULT_CHAT_MODEL

export function createOpenRouterModel(params: { apiKey: string; model: string }) {
  const provider = createOpenRouter({
    apiKey: params.apiKey,
    headers: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "Maia",
    },
  })
  return provider.chat(resolveAiModelAlias(params.model))
}

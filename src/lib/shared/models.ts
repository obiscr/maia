export type ModelInfo = { id: string; name: string; provider: string }

export type GroupedModels = { provider: string; models: ModelInfo[] }

export const AVAILABLE_MODELS: ModelInfo[] = [
  // Anthropic
  { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6", provider: "Anthropic" },
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", provider: "Anthropic" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic" },
  // OpenAI
  { id: "openai/gpt-5.2-pro", name: "GPT-5.2 Pro", provider: "OpenAI" },
  { id: "openai/gpt-5.2", name: "GPT-5.2", provider: "OpenAI" },
  { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex", provider: "OpenAI" },
  // Google
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", provider: "Google" },
  { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash", provider: "Google" },
  // MiniMax
  { id: "minimax/minimax-m2.5", name: "MiniMax M2.5", provider: "MiniMax" },
  // Moonshot
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5", provider: "Moonshot" },
]

export const DEFAULT_CHAT_MODEL = "anthropic/claude-opus-4.6"

export function groupModelsByProvider(models: ModelInfo[], currentModel?: string): GroupedModels[] {
  const list = models.slice()

  if (currentModel && !list.some((m) => m.id === currentModel)) {
    list.unshift({ id: currentModel, name: currentModel, provider: "Custom" })
  }

  const byProvider = new Map<string, ModelInfo[]>()
  const providerOrder: string[] = []
  for (const m of list) {
    const provider = String(m.provider ?? "").trim() || "Other"
    if (!byProvider.has(provider)) {
      byProvider.set(provider, [])
      providerOrder.push(provider)
    }
    byProvider.get(provider)!.push(m)
  }

  return providerOrder.map((provider) => ({ provider, models: byProvider.get(provider)! }))
}

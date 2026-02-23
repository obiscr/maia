export type ModelBadge = "chat" | "plan" | "agent"

export type ModelInfo = { id: string; name: string; provider: string; badges?: ModelBadge[] }

export type GroupedModels = { provider: string; models: ModelInfo[] }

const ALL_BADGES: ModelBadge[] = ["chat", "plan", "agent"]
const CHAT_PLAN: ModelBadge[] = ["chat", "plan"]
const CHAT_ONLY: ModelBadge[] = ["chat"]

export const AVAILABLE_MODELS: ModelInfo[] = [
  // Anthropic
  { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6", provider: "Anthropic", badges: ALL_BADGES },
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", provider: "Anthropic", badges: ALL_BADGES },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic", badges: CHAT_PLAN },
  // OpenAI
  { id: "openai/gpt-5.2-pro", name: "GPT-5.2 Pro", provider: "OpenAI", badges: ALL_BADGES },
  { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex", provider: "OpenAI", badges: ALL_BADGES },
  { id: "openai/gpt-5.2", name: "GPT-5.2", provider: "OpenAI", badges: CHAT_PLAN },
  // Google
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", provider: "Google", badges: CHAT_PLAN },
  { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash", provider: "Google", badges: CHAT_ONLY },
  // MiniMax
  { id: "minimax/minimax-m2.5", name: "MiniMax M2.5", provider: "MiniMax", badges: CHAT_PLAN },
  // Moonshot
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5", provider: "Moonshot", badges: CHAT_ONLY },
  // Qwen
  { id: "qwen/qwen3.5-plus-02-15", name: "Qwen3.5 Plus", provider: "Qwen", badges: CHAT_ONLY },
  { id: "qwen/qwen3.5-397b-a17b", name: "Qwen3.5", provider: "Qwen", badges: CHAT_ONLY },
  // DeepSeek
  { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", provider: "DeepSeek", badges: CHAT_ONLY },
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

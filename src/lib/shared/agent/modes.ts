export type AgentMode = "agent" | "chat" | "plan"

export const AGENT_MODES: readonly AgentMode[] = ["agent", "chat", "plan"] as const

export const DEFAULT_AGENT_MODE: AgentMode = "agent"

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && (AGENT_MODES as readonly string[]).includes(value)
}

export const AGENT_MODE_I18N_KEYS: Record<AgentMode, string> = {
  agent: "agent.mode.agent",
  chat: "agent.mode.chat",
  plan: "agent.mode.plan",
}

/** @deprecated Use `toAgentMode` instead. */
export function profileIdToMode(profileId: string | null | undefined): AgentMode {
  return toAgentMode(profileId)
}

export function toAgentMode(value: string | null | undefined): AgentMode {
  if (!value) return DEFAULT_AGENT_MODE
  if (isAgentMode(value)) return value
  return DEFAULT_AGENT_MODE
}

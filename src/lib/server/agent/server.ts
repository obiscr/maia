import "server-only"

import { getAgentEngine } from "@/lib/server/agent/agent-engine"

export async function ensureAgentEngineRunning(opts?: { tick?: boolean }) {
  const eng = getAgentEngine()
  if (opts?.tick !== false) void eng.tick()
  return eng
}

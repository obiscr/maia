import "server-only"

import { getEngine } from "@/lib/server/maia/engine"
import { ensureMaiaInitialized } from "@/lib/server/maia/init"

export async function ensureEngineStarted() {
  await ensureMaiaInitialized()
  const eng = getEngine()
  return eng
}

export async function ensureEngineRunning(opts?: { tick?: boolean }) {
  const eng = await ensureEngineStarted()
  // Kick a tick so newly created runs start quickly.
  if (opts?.tick !== false) void eng.tick({ priority: "low", reason: "ensureEngineRunning" })
  return eng
}

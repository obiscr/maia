import "server-only"

import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJsonAtomic } from "@/lib/server/maia/fs"
import { maiaDataDir } from "@/lib/server/maia/paths"

export type RuntimeSettings = Partial<{
  globalRunConcurrency: number
  perRunStepConcurrency: number
  defaultStepTimeoutMs: number
  inputDownloadConcurrency: number
  inputDownloadTimeoutMs: number
  inputDownloadMaxBytes: number
}>

function settingsPath() {
  return path.join(maiaDataDir(), "settings", "runtime.json")
}

export function readRuntimeSettingsSync(): RuntimeSettings {
  const p = settingsPath()
  try {
    const raw = fs.readFileSync(p, "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as RuntimeSettings
  } catch {
    return {}
  }
}

export async function writeRuntimeSettings(params: RuntimeSettings) {
  const p = settingsPath()
  await ensureDir(path.dirname(p))
  await writeJsonAtomic(p, params)
  return { ok: true as const }
}

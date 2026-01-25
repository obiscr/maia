import "server-only"

import { readJsonFileOrNull, writeJsonAtomic } from "@/lib/server/maia/fs"
import {
  instanceConfigPathSync as instanceConfigPathSyncCore,
  isDataDirControlledByEnvSync as isDataDirControlledByEnvSyncCore,
  resolveMaiaDataDirSync,
} from "@/lib/server/maia/instance-location"

type InstanceConfig = {
  /**
   * Absolute or relative path for instance data directory.
   * - If relative: resolved from projectRoot()
   * - Supports "~" expansion
   */
  dataDir?: string
}

function configPath() {
  // Keep the path computation in one place (shared with Prisma CLI).
  return instanceConfigPathSyncCore()
}

export function instanceConfigPathSync(): string {
  return configPath()
}

export function isDataDirControlledByEnvSync(): boolean {
  return isDataDirControlledByEnvSyncCore()
}

export async function readInstanceConfig(): Promise<InstanceConfig> {
  const raw = await readJsonFileOrNull<unknown>(configPath())
  if (!raw || typeof raw !== "object") return {}
  const cfg = raw as Record<string, unknown>
  return {
    dataDir: typeof cfg.dataDir === "string" ? cfg.dataDir : undefined,
  }
}

export async function writeInstanceConfig(next: InstanceConfig) {
  const cleaned: InstanceConfig = {}
  if (typeof next.dataDir === "string" && next.dataDir.trim()) cleaned.dataDir = next.dataDir.trim()
  await writeJsonAtomic(configPath(), cleaned)
  return { ok: true as const }
}

export function resolveDataDirSync(): string {
  // Delegate to the shared resolver so Prisma CLI and runtime stay in sync.
  return resolveMaiaDataDirSync()
}

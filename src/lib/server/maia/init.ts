import "server-only"

import { ensureDir } from "@/lib/server/maia/fs"
import { jobRunsRootDir, runsRootDir, workflowRootDir, maiaDataDir, blobsRootDir } from "@/lib/server/maia/paths"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"

import { ensureOpsCleanupEngineRunning } from "@/lib/server/operations/cleanup-engine"

declare global {
  // Persist across Next.js dev HMR reloads within the same Node process.
  // On a real process restart this resets, which is when we DO want restart recovery logic to run.
  var __maiaDidInit: boolean | undefined
}

export async function ensureMaiaInitialized() {
  if (globalThis.__maiaDidInit) return
  globalThis.__maiaDidInit = true

  await ensureDir(maiaDataDir())
  await ensureDir(runsRootDir())
  await ensureDir(jobRunsRootDir())
  await ensureDir(blobsRootDir())
  await ensureDir(workflowRootDir())

  // Before schema exists (fresh install), skip background DB loops/recovery.
  if (!isCurrentDatabaseSchemaReadySync()) return

  // Start best-effort background maintenance loops (Node runtimes).
  ensureOpsCleanupEngineRunning()
}

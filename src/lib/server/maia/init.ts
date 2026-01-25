import "server-only"

import { prisma } from "@/lib/server/db"
import { ensureDir } from "@/lib/server/maia/fs"
import { jobRunsRootDir, runsRootDir, workflowRootDir, maiaDataDir, blobsRootDir } from "@/lib/server/maia/paths"
import { AttemptStatus, LogLevel, RunStatus, StepStatus } from "@prisma/client"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"

import { emitRunStatus, emitStepStatus, emitSystem } from "@/lib/server/maia/logging"
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

  // Restart recovery:
  // If the process truly restarted, any RUNNING attempts in the DB will never report completion.
  // Mark them as INTERRUPTED and fail the corresponding run/step (fail-fast semantics).
  //
  // IMPORTANT (dev): we must NOT run this on Next.js HMR reloads within the same process,
  // otherwise we can interrupt actively running attempts and leave the run/step stuck.
  const interruptedAt = new Date()
  const runningAttempts = await prisma.attempt.findMany({
    where: { status: AttemptStatus.RUNNING },
    select: { runId: true, stepKey: true, attemptNo: true },
  })
  if (runningAttempts.length === 0) return

  const affectedRunIds = [...new Set(runningAttempts.map((a) => String(a.runId)))]
  const affectedStepKeysByRun = new Map<string, Set<string>>()
  for (const a of runningAttempts) {
    const runId = String(a.runId)
    const stepKey = String(a.stepKey)
    ;(affectedStepKeysByRun.get(runId) ?? affectedStepKeysByRun.set(runId, new Set()).get(runId)!).add(stepKey)
  }

  await prisma.attempt.updateMany({
    where: { status: AttemptStatus.RUNNING },
    data: {
      status: AttemptStatus.INTERRUPTED,
      finishedAt: interruptedAt,
      errorCode: "UNKNOWN",
      errorMessage: "Interrupted by engine restart",
      errorMetaJson: JSON.stringify({ reason: "ENGINE_RESTART" }),
      errorAt: interruptedAt,
    },
  })

  // Fail any steps that were marked RUNNING (they correspond to interrupted attempts).
  for (const [runId, stepKeys] of affectedStepKeysByRun.entries()) {
    await prisma.runStep.updateMany({
      where: { runId, stepKey: { in: [...stepKeys] }, status: StepStatus.RUNNING },
      data: { status: StepStatus.FAILED, finishedAt: interruptedAt },
    })
    for (const stepKey of stepKeys) {
      await emitStepStatus(runId, stepKey, StepStatus.FAILED).catch(() => {})
    }
  }

  // Fail affected runs and skip remaining pending steps for clarity.
  for (const runId of affectedRunIds) {
    await prisma.run.updateMany({
      where: { id: runId, status: { in: [RunStatus.RUNNING, RunStatus.PENDING_INPUTS] } },
      data: { status: RunStatus.FAILED, finishedAt: interruptedAt },
    })
    await prisma.runStep.updateMany({
      where: { runId, status: StepStatus.PENDING },
      data: { status: StepStatus.SKIPPED, finishedAt: interruptedAt },
    })
    await emitRunStatus(runId, RunStatus.FAILED).catch(() => {})
    await emitSystem(
      runId,
      "engine restarted: interrupted running attempt(s); marking run as FAILED",
      LogLevel.WARN,
    ).catch(() => {})
  }
}

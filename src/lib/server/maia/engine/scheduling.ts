import "server-only"

import { RunStatus, StepStatus } from "@prisma/client"
import type { RunStep } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { LogLevel } from "@prisma/client"
import { emitSystem } from "@/lib/server/maia/logging"

const SQLITE_TICK_RUNNING_RUNS_TAKE = 25

export async function scheduleRuns(params: { scheduleRun: (runId: string) => Promise<void> }) {
  const runs = await prisma.run.findMany({
    where: { status: RunStatus.RUNNING },
    orderBy: [{ createdAt: "asc" }],
    take: SQLITE_TICK_RUNNING_RUNS_TAKE,
  })
  for (const run of runs) {
    await params.scheduleRun(run.id)
  }
}

export async function scheduleRun(params: {
  runId: string
  perRunStepConcurrency: number
  claimAndStartAttempt: (runId: string, stepKey: string) => Promise<boolean>
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  const runId = params.runId
  const now = new Date()

  // If any step FAILED, fail the run and stop.
  //
  // NOTE: We intentionally do NOT immediately cancel the run just because a step is CANCELED.
  // This enables "rerun_step" forked runs to execute the requested step even if the source run
  // had a canceled sibling step (e.g. user canceled mid-run). We will finish as CANCELED once
  // there is no runnable/running work left.
  const steps: RunStep[] = await prisma.runStep.findMany({ where: { runId } })
  const anyFailed = steps.some((s: RunStep) => s.status === StepStatus.FAILED)
  const anyCanceled = steps.some((s: RunStep) => s.status === StepStatus.CANCELED)
  if (anyFailed) {
    await params.finishRun(runId, RunStatus.FAILED)
    return
  }

  const runningSteps = steps.filter((s: RunStep) => s.status === StepStatus.RUNNING).length
  const stepSlots = Math.max(0, params.perRunStepConcurrency - runningSteps)
  if (stepSlots <= 0) return

  const succeeded = new Set(
    steps.filter((s: RunStep) => s.status === StepStatus.SUCCEEDED).map((s: RunStep) => s.stepKey),
  )
  const runnable: string[] = []

  for (const s of steps) {
    if (s.status !== StepStatus.PENDING) continue
    if (s.nextAttemptAt && new Date(s.nextAttemptAt).getTime() > now.getTime()) continue
    const deps = JSON.parse(s.depsJson) as string[]
    if (deps.every((d) => succeeded.has(d))) runnable.push(s.stepKey)
  }

  let started = 0
  for (const stepKey of runnable) {
    if (started >= stepSlots) break
    // Attempt to claim this step (idempotent) and run it.
    const claimed = await params.claimAndStartAttempt(runId, stepKey)
    if (claimed) started += 1
  }

  // If there's still running work or newly-started work, keep the run RUNNING.
  // (Even if some steps are already CANCELED.)
  if (runningSteps > 0 || started > 0) return

  // If there is runnable work but no slots, we would have returned above; at this point runnable is empty.
  // If the run is "stalled" (no runnable steps, no running steps), we can finish it.
  if (anyCanceled) {
    await params.finishRun(runId, RunStatus.CANCELED)
    return
  }

  // All done?
  const terminalStepStatuses = new Set<StepStatus>([StepStatus.SUCCEEDED, StepStatus.SKIPPED, StepStatus.CANCELED])
  const allTerminal = steps.every((s: RunStep) => terminalStepStatuses.has(s.status))
  const allSucceeded = steps.every((s: RunStep) => s.status === StepStatus.SUCCEEDED)
  if (allTerminal) {
    await params.finishRun(runId, allSucceeded ? RunStatus.SUCCEEDED : RunStatus.CANCELED)
    return
  }

  // Stalled: no runnable/running work, but some steps are still PENDING.
  // This indicates an invalid/unsatisfied graph (most commonly: cycle or missing deps).
  //
  // NOTE: In multi-scheduler/concurrent scenarios, we can briefly observe:
  // - no RUNNING steps (because a claim/start is in-flight)
  // - no started steps in this tick (because claimAndStartAttempt returned false)
  // To reduce false "stalled" failures, do a single re-check from DB before failing.
  const pending = steps.filter((s) => s.status === StepStatus.PENDING).map((s) => String(s.stepKey))
  if (pending.length) {
    const freshSteps: RunStep[] = await prisma.runStep.findMany({ where: { runId } }).catch(() => steps)
    const freshRunning = freshSteps.filter((s) => s.status === StepStatus.RUNNING).length
    if (freshRunning > 0) return

    const freshAnyFailed = freshSteps.some((s) => s.status === StepStatus.FAILED)
    if (freshAnyFailed) {
      await params.finishRun(runId, RunStatus.FAILED)
      return
    }

    const freshAnyCanceled = freshSteps.some((s) => s.status === StepStatus.CANCELED)
    if (freshAnyCanceled) {
      await params.finishRun(runId, RunStatus.CANCELED)
      return
    }

    const freshSucceeded = new Set(freshSteps.filter((s) => s.status === StepStatus.SUCCEEDED).map((s) => s.stepKey))
    const freshRunnable: string[] = []
    for (const s of freshSteps) {
      if (s.status !== StepStatus.PENDING) continue
      const deps = JSON.parse(s.depsJson) as string[]
      if (deps.every((d) => freshSucceeded.has(d))) freshRunnable.push(s.stepKey)
    }
    if (freshRunnable.length) return

    const pendingStepKeys = freshSteps.filter((s) => s.status === StepStatus.PENDING).map((s) => String(s.stepKey))
    const succeededStepKeys = [...freshSucceeded].map((k) => String(k))
    const detail = `run stalled: no runnable steps (pending=${pendingStepKeys.length})`
    await prisma.run
      .update({
        where: { id: runId },
        data: {
          failureCode: "RUN_STALLED",
          failureMessage: detail,
          failureMetaJson: JSON.stringify({ pendingStepKeys, succeededStepKeys }),
          failureAt: new Date(),
        },
      })
      .catch(() => {})
    await emitSystem(runId, detail, LogLevel.ERROR).catch(() => {})
    await params.finishRun(runId, RunStatus.FAILED)
  }
}

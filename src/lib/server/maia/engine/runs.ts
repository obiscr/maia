import "server-only"

import {
  AttemptStatus,
  JobRunAttemptStatus,
  JobRunStatus,
  LogLevel,
  LogSource,
  RunStatus,
  StepStatus,
} from "@prisma/client"
import type { Run } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { safeJsonParseObject, safeJsonStringify } from "@/lib/server/maia/engine/helpers"
import { computeRetryBackoffMs } from "@/lib/server/maia/engine/retry"
import { bestEffortRunStepFailure } from "@/lib/server/maia/engine/run-step-failure"
import type { DownloadingInput, RunningProc } from "@/lib/server/maia/engine/types"
import { emitLogLineWithMeta, emitRunStatus, emitStepStatus, emitSystem } from "@/lib/server/maia/logging"
import { emitJobRunState } from "@/lib/server/maia/realtime"

async function cleanupAfterTerminal(params: {
  runId: string
  status: RunStatus
  now: Date
  running: Map<string, RunningProc>
  inputDownloads: Map<string, DownloadingInput>
}) {
  const { runId, status, now, running, inputDownloads } = params
  if (status !== RunStatus.FAILED && status !== RunStatus.CANCELED) return

  // Abort any in-flight input downloads for this run.
  for (const [k, d] of inputDownloads.entries()) {
    if (d.runId !== runId) continue
    try {
      d.abort.abort(new Error(`run ${String(status).toLowerCase()}`))
    } catch {}
    inputDownloads.delete(k)
  }

  // Mark running attempts/steps as CANCELED first so the process 'close' handler can't overwrite.
  const runningSteps = await prisma.runStep.findMany({
    where: { runId, status: StepStatus.RUNNING },
    select: { stepKey: true },
  })
  const runningStepKeys = runningSteps.map((s) => String(s.stepKey))

  if (runningStepKeys.length) {
    // Ensure cancellation is visible in the per-step log viewer.
    for (const stepKey of runningStepKeys) {
      await emitLogLineWithMeta({
        runId,
        stepKey,
        attemptNo: 0,
        stream: "stderr",
        line: `run canceled`,
        level: LogLevel.INFO,
        source: LogSource.SYSTEM,
      }).catch(() => {})
    }
    await prisma.attempt.updateMany({
      where: { runId, status: AttemptStatus.RUNNING },
      data: { status: AttemptStatus.CANCELED, finishedAt: now },
    })
    await prisma.runStep.updateMany({
      where: { runId, status: StepStatus.RUNNING },
      data: { status: StepStatus.CANCELED, finishedAt: now },
    })
  }

  // Mark remaining pending steps as SKIPPED for clarity.
  const pendingSteps = await prisma.runStep.findMany({
    where: { runId, status: StepStatus.PENDING },
    select: { stepKey: true },
  })
  const pendingStepKeys = pendingSteps.map((s) => String(s.stepKey))
  if (pendingStepKeys.length) {
    await prisma.runStep.updateMany({
      where: { runId, status: StepStatus.PENDING },
      data: { status: StepStatus.SKIPPED, finishedAt: now },
    })
  }

  // Kill any running children for this run (best-effort).
  for (const [k, proc] of running.entries()) {
    if (proc.runId !== runId) continue
    try {
      if (proc.timeout) clearTimeout(proc.timeout)
      if (proc.heartbeat) clearInterval(proc.heartbeat)
      if (proc.kind === "child_process") {
        proc.child.kill("SIGKILL")
      } else if (proc.kind === "runner") {
        try {
          proc.abort.abort(new Error(`run ${String(status).toLowerCase()}`))
        } catch {}
        void proc.cancel("kill").catch(() => {})
      }
    } catch {}
    running.delete(k)
  }

  // Emit step status updates (best-effort; snapshot will correct on reconnect).
  for (const stepKey of runningStepKeys) {
    await emitStepStatus(runId, stepKey, StepStatus.CANCELED)
  }
  for (const stepKey of pendingStepKeys) {
    await emitStepStatus(runId, stepKey, StepStatus.SKIPPED)
  }
}

export async function processCancelRequestedRuns(params: {
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  const SQLITE_TICK_CANCEL_RUNS_TAKE = 25
  const runs = await prisma.run.findMany({
    where: {
      cancelRequestedAt: { not: null },
      status: { in: [RunStatus.PENDING_INPUTS, RunStatus.RUNNING] },
    },
    orderBy: [{ cancelRequestedAt: "asc" }],
    take: SQLITE_TICK_CANCEL_RUNS_TAKE,
    select: { id: true },
  })
  if (!runs.length) return
  for (const r of runs) {
    await params.finishRun(r.id, RunStatus.CANCELED)
  }
}

export async function reconcileTerminalRuns(params: {
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  const runs = await prisma.run.findMany({
    where: {
      status: { in: [RunStatus.FAILED, RunStatus.CANCELED] },
      steps: { some: { status: { in: [StepStatus.PENDING, StepStatus.RUNNING] } } },
    },
    orderBy: [{ updatedAt: "asc" }],
    take: 25,
    select: { id: true, status: true },
  })
  for (const r of runs) {
    await params.finishRun(r.id, r.status)
  }
}

export async function finishRun(params: {
  runId: string
  status: RunStatus
  running: Map<string, RunningProc>
  inputDownloads: Map<string, DownloadingInput>
}) {
  const { runId, running, inputDownloads } = params
  const now = new Date()
  const run: Run | null = await prisma.run.findUnique({ where: { id: runId } })
  if (!run) return

  const terminalRunStatuses = new Set<RunStatus>([RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELED])
  const alreadyTerminal = terminalRunStatuses.has(run.status)
  const finalStatus = alreadyTerminal ? run.status : params.status

  let effectiveFailureCode: string | null = run.failureCode ?? null
  let effectiveFailureMessage: string | null = run.failureMessage ?? null
  let effectiveFailureMetaJson: string | null = run.failureMetaJson ?? null

  if (!alreadyTerminal) {
    // Allow upstream components (e.g. input acquisition) to set a specific failureCode/message.
    // If already set, do NOT overwrite with generic STEP_FAILED.
    const hasExistingFailure = Boolean(run.failureCode || run.failureMessage || run.failureAt)
    const failure =
      params.status === RunStatus.FAILED && !hasExistingFailure
        ? await (async () => {
            const stepFailure = await bestEffortRunStepFailure(runId)
            const failureCode = "STEP_FAILED"
            const failureMessage = stepFailure ? `step ${stepFailure.stepKey} failed` : `run failed: ${runId}`
            const stepMetaObj = stepFailure?.stepErrorMetaJson
              ? safeJsonParseObject(stepFailure.stepErrorMetaJson)
              : null
            const timeoutMs = typeof stepMetaObj?.timeoutMs === "number" ? Number(stepMetaObj.timeoutMs) : null
            const signal = typeof stepMetaObj?.signal === "string" ? String(stepMetaObj.signal) : null
            const failureMetaJson = stepFailure
              ? safeJsonStringify({
                  stepKey: stepFailure.stepKey,
                  attemptNo: stepFailure.attemptNo,
                  stepErrorCode: stepFailure.stepErrorCode,
                  stepErrorMessage: stepFailure.stepErrorMessage,
                  stepErrorMetaJson: stepFailure.stepErrorMetaJson,
                  timeoutMs,
                  signal,
                  exitCode: stepFailure.exitCode,
                })
              : null
            return { failureCode, failureMessage, failureMetaJson }
          })()
        : null

    effectiveFailureCode = run.failureCode ?? failure?.failureCode ?? null
    effectiveFailureMessage = run.failureMessage ?? failure?.failureMessage ?? null
    effectiveFailureMetaJson = run.failureMetaJson ?? failure?.failureMetaJson ?? null

    await prisma.run.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        finishedAt: now,
        failureCode: effectiveFailureCode,
        failureMessage: effectiveFailureMessage,
        failureMetaJson: effectiveFailureMetaJson,
        failureAt: run.failureAt ?? (failure ? now : null),
      },
    })
    await emitRunStatus(runId, finalStatus)
  }

  // If this run was created from a JobRun, mirror terminal state back to the JobRun.
  const job = await prisma.jobRun.findFirst({
    where: { runId },
    select: {
      id: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      cancelRequestedAt: true,
      cancelRequestedReason: true,
    },
  })
  if (job && job.status === JobRunStatus.RUNNING) {
    if (finalStatus === RunStatus.FAILED) {
      const canRetry = job.attemptCount < job.maxAttempts
      if (canRetry) {
        const backoffMs = computeRetryBackoffMs(job.attemptCount)
        const stepFailure = await bestEffortRunStepFailure(runId)
        const jobErrorCode = effectiveFailureCode ?? (stepFailure ? "RUN_STEP_FAILED" : "RUN_FAILED")
        const jobErrorMessage =
          effectiveFailureMessage ?? (stepFailure ? `step ${stepFailure.stepKey} failed` : `run failed: ${runId}`)
        const jobErrorMetaJson =
          effectiveFailureMetaJson ??
          (stepFailure
            ? safeJsonStringify({
                runId,
                stepKey: stepFailure.stepKey,
                attemptNo: stepFailure.attemptNo,
                stepErrorCode: stepFailure.stepErrorCode,
                stepErrorMessage: stepFailure.stepErrorMessage,
                stepErrorMetaJson: stepFailure.stepErrorMetaJson,
              })
            : safeJsonStringify({ runId }))
        await prisma.jobRun
          .update({
            where: { id: job.id },
            data: {
              status: JobRunStatus.QUEUED,
              queuedAt: now,
              nextAttemptAt: new Date(now.getTime() + backoffMs),
              lastErrorCode: jobErrorCode,
              lastErrorMessage: jobErrorMessage,
              lastErrorMetaJson: jobErrorMetaJson,
              lastErrorAt: now,
              runId: null,
              claimedBy: null,
              claimedAt: null,
              leaseExpiresAt: null,
              finishedAt: null,
            },
          })
          .catch(() => {})
        await emitJobRunState(job.id).catch(() => {})
        await prisma.jobRunAttempt
          .updateMany({
            where: { jobRunId: job.id, attemptNo: job.attemptCount, status: JobRunAttemptStatus.RUNNING },
            data: {
              status: JobRunAttemptStatus.FAILED,
              finishedAt: now,
              errorCode: jobErrorCode,
              errorMessage: jobErrorMessage,
              errorMetaJson: jobErrorMetaJson,
              errorAt: now,
            },
          })
          .catch(() => {})
      } else {
        const stepFailure = await bestEffortRunStepFailure(runId)
        const jobErrorCode = effectiveFailureCode ?? (stepFailure ? "RUN_STEP_FAILED" : "RUN_FAILED")
        const jobErrorMessage =
          effectiveFailureMessage ?? (stepFailure ? `step ${stepFailure.stepKey} failed` : `run failed: ${runId}`)
        const jobErrorMetaJson =
          effectiveFailureMetaJson ??
          (stepFailure
            ? safeJsonStringify({
                runId,
                stepKey: stepFailure.stepKey,
                attemptNo: stepFailure.attemptNo,
                stepErrorCode: stepFailure.stepErrorCode,
              })
            : safeJsonStringify({ runId }))
        await prisma.jobRun
          .update({
            where: { id: job.id },
            data: {
              status: JobRunStatus.FAILED,
              finishedAt: now,
              lastErrorCode: jobErrorCode,
              lastErrorMessage: jobErrorMessage,
              lastErrorMetaJson: jobErrorMetaJson,
              lastErrorAt: now,
              leaseExpiresAt: null,
            },
          })
          .catch(() => {})
        await emitJobRunState(job.id).catch(() => {})
        await prisma.jobRunAttempt
          .updateMany({
            where: { jobRunId: job.id, attemptNo: job.attemptCount, status: JobRunAttemptStatus.RUNNING },
            data: {
              status: JobRunAttemptStatus.FAILED,
              finishedAt: now,
              errorCode: jobErrorCode,
              errorMessage: jobErrorMessage,
              errorMetaJson: jobErrorMetaJson,
              errorAt: now,
            },
          })
          .catch(() => {})
      }
    } else if (finalStatus === RunStatus.SUCCEEDED) {
      await prisma.jobRun
        .update({
          where: { id: job.id },
          data: {
            status: JobRunStatus.SUCCEEDED,
            finishedAt: now,
            leaseExpiresAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastErrorMetaJson: null,
            lastErrorAt: null,
          },
        })
        .catch(() => {})
      await emitJobRunState(job.id).catch(() => {})
      await prisma.jobRunAttempt
        .updateMany({
          where: { jobRunId: job.id, attemptNo: job.attemptCount, status: JobRunAttemptStatus.RUNNING },
          data: { status: JobRunAttemptStatus.SUCCEEDED, finishedAt: now },
        })
        .catch(() => {})
    } else if (finalStatus === RunStatus.CANCELED) {
      // Cancellation is a terminal outcome (status), not a failure/error.
      // Also ensure cancelRequestedAt is populated on the JobRun so UIs can show canceling/cancel time reliably.
      const cancelRequestedAt = job.cancelRequestedAt ?? run.cancelRequestedAt ?? now
      const cancelRequestedReason = job.cancelRequestedReason ?? run.cancelRequestedReason ?? null
      await prisma.jobRun
        .update({
          where: { id: job.id },
          data: {
            status: JobRunStatus.CANCELED,
            finishedAt: now,
            leaseExpiresAt: null,
            cancelRequestedAt,
            cancelRequestedReason,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastErrorMetaJson: null,
            lastErrorAt: null,
          },
        })
        .catch(() => {})
      await emitJobRunState(job.id).catch(() => {})
      await prisma.jobRunAttempt
        .updateMany({
          where: { jobRunId: job.id, attemptNo: job.attemptCount, status: JobRunAttemptStatus.RUNNING },
          data: {
            status: JobRunAttemptStatus.CANCELED,
            finishedAt: now,
            errorCode: null,
            errorMessage: null,
            errorMetaJson: null,
            errorAt: null,
          },
        })
        .catch(() => {})
    }
  }

  // Ensure terminal invariants (avoid "PENDING forever" and stop any running work).
  await cleanupAfterTerminal({ runId, status: finalStatus, now, running, inputDownloads })

  if (finalStatus === RunStatus.CANCELED) {
    await emitSystem(runId, "run canceled", LogLevel.INFO).catch(() => {})
  } else if (finalStatus === RunStatus.FAILED) {
    await emitSystem(runId, "run failed", LogLevel.ERROR).catch(() => {})
  }
}

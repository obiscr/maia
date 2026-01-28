import "server-only"

import { AttemptStatus, LogLevel, RunStatus, StepStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { safeJsonStringify } from "@/lib/server/maia/engine/helpers"
import { emitStepStatus, emitSystem } from "@/lib/server/maia/logging"

const SQLITE_TICK_RECONCILE_ATTEMPTS_TAKE = 25

export async function reconcileAttempts(params: {
  maxInterruptedAttemptsPerStep: number
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  await reconcileTimedOutAttempts(params)
  await reconcileExpiredAttemptLeases(params)
}

async function reconcileTimedOutAttempts(params: { finishRun: (runId: string, status: RunStatus) => Promise<void> }) {
  const now = new Date()
  const timedOut = await prisma.attempt.findMany({
    where: {
      status: AttemptStatus.RUNNING,
      deadlineAt: { not: null, lt: now },
    },
    orderBy: [{ deadlineAt: "asc" }],
    take: SQLITE_TICK_RECONCILE_ATTEMPTS_TAKE,
    select: {
      runId: true,
      stepKey: true,
      attemptNo: true,
      startedAt: true,
      deadlineAt: true,
      runStep: { select: { timeoutMs: true, status: true } },
    },
  })
  for (const a of timedOut) {
    const runId = String(a.runId)
    const stepKey = String(a.stepKey)
    const attemptNo = Number(a.attemptNo)
    const timeoutMs = Number(a.runStep?.timeoutMs ?? 0)
    const message =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? `Timed out after ${timeoutMs}ms` : `Timed out (deadline exceeded)`

    const applied = await prisma.$transaction(async (tx) => {
      const at = await tx.attempt.updateMany({
        where: { runId, stepKey, attemptNo, status: AttemptStatus.RUNNING },
        data: {
          status: AttemptStatus.FAILED,
          finishedAt: now,
          exitCode: null,
          errorCode: "STEP_TIMEOUT",
          errorMessage: message,
          errorMetaJson: safeJsonStringify({ timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : null }),
          errorAt: now,
          workerId: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      })
      const rs = await tx.runStep.updateMany({
        where: { runId, stepKey, status: StepStatus.RUNNING },
        data: { status: StepStatus.FAILED, finishedAt: now },
      })
      return at.count > 0 || rs.count > 0
    })

    if (!applied) continue
    await emitSystem(runId, `step ${stepKey} timed out (reconciled)`, LogLevel.WARN).catch(() => {})
    await emitStepStatus(runId, stepKey, StepStatus.FAILED, attemptNo).catch(() => {})
    await params.finishRun(runId, RunStatus.FAILED)
  }
}

async function reconcileExpiredAttemptLeases(params: {
  maxInterruptedAttemptsPerStep: number
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  const now = new Date()
  const expired = await prisma.attempt.findMany({
    where: {
      status: AttemptStatus.RUNNING,
      OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null }],
    },
    orderBy: [{ leaseExpiresAt: "asc" }],
    take: SQLITE_TICK_RECONCILE_ATTEMPTS_TAKE,
    select: {
      runId: true,
      stepKey: true,
      attemptNo: true,
      workerId: true,
      leaseExpiresAt: true,
    },
  })

  for (const a of expired) {
    const runId = String(a.runId)
    const stepKey = String(a.stepKey)
    const attemptNo = Number(a.attemptNo)
    const step = await prisma.runStep.findUnique({
      where: { runId_stepKey: { runId, stepKey } },
      select: { retryPolicyJson: true },
    })
    const policy = parseRetryPolicy(step?.retryPolicyJson ?? "{}")
    const maxRetries = Math.min(policy.workerLost.maxRetries, params.maxInterruptedAttemptsPerStep)
    const priorInterrupted = await prisma.attempt.count({
      where: { runId, stepKey, status: AttemptStatus.INTERRUPTED },
    })
    const interruptedCount = priorInterrupted + 1
    const canRetry = interruptedCount <= maxRetries

    const detail = {
      workerId: a.workerId ? String(a.workerId) : null,
      leaseExpiresAt: a.leaseExpiresAt ? a.leaseExpiresAt.toISOString() : null,
      interruptedCount,
      maxRetries,
    }

    if (canRetry) {
      const delayMs = computeBackoffMs({
        attemptIndex: interruptedCount,
        backoffMs: policy.workerLost.backoffMs,
        maxBackoffMs: policy.workerLost.maxBackoffMs,
        multiplier: policy.workerLost.multiplier,
        jitter: policy.workerLost.jitter,
      })
      const nextAttemptAt = new Date(now.getTime() + delayMs)
      const applied = await prisma.$transaction(async (tx) => {
        const at = await tx.attempt.updateMany({
          where: { runId, stepKey, attemptNo, status: AttemptStatus.RUNNING },
          data: {
            status: AttemptStatus.INTERRUPTED,
            finishedAt: now,
            exitCode: null,
            errorCode: "WORKER_LOST",
            errorMessage: "Worker lease expired",
            errorMetaJson: safeJsonStringify(detail),
            errorAt: now,
            workerId: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
          },
        })
        const rs = await tx.runStep.updateMany({
          where: { runId, stepKey, status: StepStatus.RUNNING },
          data: { status: StepStatus.PENDING, startedAt: null, finishedAt: null, nextAttemptAt },
        })
        return at.count > 0 || rs.count > 0
      })
      if (!applied) continue
      await emitSystem(runId, `step ${stepKey} worker lost; retrying`, LogLevel.WARN).catch(() => {})
      await emitStepStatus(runId, stepKey, StepStatus.PENDING).catch(() => {})
      continue
    }

    // Too many interruptions => fail the step/run.
    const applied = await prisma.$transaction(async (tx) => {
      const at = await tx.attempt.updateMany({
        where: { runId, stepKey, attemptNo, status: AttemptStatus.RUNNING },
        data: {
          status: AttemptStatus.FAILED,
          finishedAt: now,
          exitCode: null,
          errorCode: "WORKER_LOST",
          errorMessage: "Worker lease expired (retry limit exceeded)",
          errorMetaJson: safeJsonStringify(detail),
          errorAt: now,
          workerId: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      })
      const rs = await tx.runStep.updateMany({
        where: { runId, stepKey, status: StepStatus.RUNNING },
        data: { status: StepStatus.FAILED, finishedAt: now },
      })
      return at.count > 0 || rs.count > 0
    })
    if (!applied) continue
    await emitSystem(runId, `step ${stepKey} worker lost; failing run`, LogLevel.ERROR).catch(() => {})
    await emitStepStatus(runId, stepKey, StepStatus.FAILED, attemptNo).catch(() => {})
    await params.finishRun(runId, RunStatus.FAILED)
  }
}

type RetryPolicy = {
  workerLost: {
    maxRetries: number
    backoffMs: number
    maxBackoffMs: number
    multiplier: number
    jitter: number
  }
}

function parseRetryPolicy(retryPolicyJson: string): RetryPolicy {
  const defaults: RetryPolicy = {
    workerLost: { maxRetries: 3, backoffMs: 1_000, maxBackoffMs: 30_000, multiplier: 2, jitter: 0.2 },
  }
  try {
    const raw = JSON.parse(String(retryPolicyJson || "{}"))
    const wl = raw?.workerLost ?? null
    const maxRetries =
      typeof wl?.maxRetries === "number" ? Math.max(0, Math.floor(wl.maxRetries)) : defaults.workerLost.maxRetries
    const backoffMs =
      typeof wl?.backoffMs === "number" ? Math.max(0, Math.floor(wl.backoffMs)) : defaults.workerLost.backoffMs
    const maxBackoffMs =
      typeof wl?.maxBackoffMs === "number" ? Math.max(0, Math.floor(wl.maxBackoffMs)) : defaults.workerLost.maxBackoffMs
    const multiplier =
      typeof wl?.multiplier === "number" ? Math.max(1, Number(wl.multiplier)) : defaults.workerLost.multiplier
    const jitter =
      typeof wl?.jitter === "number" ? Math.min(1, Math.max(0, Number(wl.jitter))) : defaults.workerLost.jitter
    return { workerLost: { maxRetries, backoffMs, maxBackoffMs, multiplier, jitter } }
  } catch {
    return defaults
  }
}

function computeBackoffMs(params: {
  attemptIndex: number
  backoffMs: number
  maxBackoffMs: number
  multiplier: number
  jitter: number
}) {
  const idx = Math.max(1, Math.floor(params.attemptIndex))
  const base = params.backoffMs * Math.pow(params.multiplier, idx - 1)
  const capped = Math.min(params.maxBackoffMs, Number.isFinite(base) ? base : params.maxBackoffMs)
  const j = Math.min(1, Math.max(0, params.jitter))
  if (j <= 0) return Math.max(0, Math.floor(capped))
  const factor = 1 - j + Math.random() * (2 * j)
  return Math.max(0, Math.floor(capped * factor))
}

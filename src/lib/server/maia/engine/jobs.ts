import "server-only"

import crypto from "crypto"

import { JobRunAttemptStatus, JobRunStatus, RunStatus } from "@prisma/client"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { safeJsonParseObject, safeJsonStringify } from "@/lib/server/maia/engine/helpers"
import { computeRetryBackoffMs } from "@/lib/server/maia/engine/retry"
import { bestEffortRunStepFailure } from "@/lib/server/maia/engine/run-step-failure"
import { emitJobRunState } from "@/lib/server/maia/realtime"

const SQLITE_TICK_RECOVER_EXPIRED_LEASES_TAKE = 25
const SQLITE_TICK_RECONCILE_JOB_RUNS_TAKE = 25

export async function requestCancelJobRun(params: {
  jobRunId: string
  reason?: string | null
  requestCancelRun: (args: { runId: string; reason?: string | null }) => Promise<unknown>
}) {
  const jobRunId = params.jobRunId
  const reason = typeof params.reason === "string" && params.reason.trim() ? params.reason.trim() : null
  const now = new Date()

  const job = await prisma.jobRun.findUnique({
    where: { id: jobRunId },
    select: { id: true, status: true, cancelRequestedAt: true, runId: true, attemptCount: true },
  })
  if (!job) return { ok: false as const, code: "NOT_FOUND" as const }

  const terminal = new Set<JobRunStatus>([JobRunStatus.SUCCEEDED, JobRunStatus.FAILED, JobRunStatus.CANCELED])
  if (terminal.has(job.status)) return { ok: true as const, alreadyTerminal: true as const }
  if (job.cancelRequestedAt) return { ok: true as const, alreadyRequested: true as const }

  // Persist request (so UI + audit can observe it immediately).
  await prisma.jobRun.update({
    where: { id: jobRunId },
    data: { cancelRequestedAt: now, cancelRequestedReason: reason },
  })
  await emitJobRunState(jobRunId).catch(() => {})

  // If the job has not started executing, apply cancellation immediately (no run exists).
  if (job.status === JobRunStatus.QUEUED || job.status === JobRunStatus.PAUSED) {
    await prisma.jobRun
      .updateMany({
        where: { id: jobRunId, status: { in: [JobRunStatus.QUEUED, JobRunStatus.PAUSED] } },
        data: {
          status: JobRunStatus.CANCELED,
          finishedAt: now,
          nextAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorMetaJson: null,
          lastErrorAt: null,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
        },
      })
      .catch(() => {})
    await emitJobRunState(jobRunId).catch(() => {})
    return { ok: true as const, applied: true as const }
  }

  // If a run exists, delegate cancellation to the run cancellation mechanism.
  const runId = job.runId ? String(job.runId) : ""
  if (runId) {
    await params.requestCancelRun({ runId, reason }).catch(() => {})
    return { ok: true as const }
  }

  // RUNNING without runId: claimed but run not created yet -> cancel the job attempt directly.
  if (job.status === JobRunStatus.RUNNING) {
    await prisma.jobRun
      .updateMany({
        where: { id: jobRunId, status: JobRunStatus.RUNNING, runId: null },
        data: {
          status: JobRunStatus.CANCELED,
          finishedAt: now,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorMetaJson: null,
          lastErrorAt: null,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
        },
      })
      .catch(() => {})
    await prisma.jobRunAttempt
      .updateMany({
        where: { jobRunId, attemptNo: job.attemptCount, status: JobRunAttemptStatus.RUNNING },
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
    await emitJobRunState(jobRunId).catch(() => {})
  }

  return { ok: true as const }
}

export async function processCancelRequestedJobRuns(params: {
  requestCancelRun: (args: { runId: string; reason?: string | null }) => Promise<unknown>
}) {
  // Enforce job cancel requests deterministically:
  // - QUEUED/PAUSED => cancel immediately (no run exists)
  // - RUNNING with runId => delegate to run cancellation
  // - RUNNING without runId => cancel job attempt directly
  //
  const SQLITE_TICK_CANCEL_JOBS_TAKE = 25
  const jobs = await prisma.jobRun.findMany({
    where: {
      cancelRequestedAt: { not: null },
      status: { in: [JobRunStatus.QUEUED, JobRunStatus.PAUSED, JobRunStatus.RUNNING] },
    },
    orderBy: [{ cancelRequestedAt: "asc" }],
    take: SQLITE_TICK_CANCEL_JOBS_TAKE,
    select: { id: true, status: true, runId: true, cancelRequestedReason: true, attemptCount: true },
  })
  if (!jobs.length) return

  const now = new Date()
  for (const j of jobs) {
    const jobRunId = String(j.id)
    const reason = j.cancelRequestedReason ? String(j.cancelRequestedReason) : null
    const msg = reason ? `canceled: ${reason}` : "canceled"

    if (j.status === JobRunStatus.QUEUED || j.status === JobRunStatus.PAUSED) {
      await prisma.jobRun
        .updateMany({
          where: { id: jobRunId, status: { in: [JobRunStatus.QUEUED, JobRunStatus.PAUSED] } },
          data: {
            status: JobRunStatus.CANCELED,
            finishedAt: now,
            nextAttemptAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastErrorMetaJson: null,
            lastErrorAt: null,
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
          },
        })
        .catch(() => {})
      await emitJobRunState(jobRunId).catch(() => {})
      continue
    }

    const runId = j.runId ? String(j.runId) : ""
    if (runId) {
      await params.requestCancelRun({ runId, reason }).catch(() => {})
      continue
    }

    if (j.status === JobRunStatus.RUNNING) {
      await prisma.jobRun
        .updateMany({
          where: { id: jobRunId, status: JobRunStatus.RUNNING, runId: null },
          data: {
            status: JobRunStatus.CANCELED,
            finishedAt: now,
            // Cancellation is a terminal outcome (status), not a failure/error.
            lastErrorCode: null,
            lastErrorMessage: null,
            lastErrorMetaJson: null,
            lastErrorAt: null,
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
          },
        })
        .catch(() => {})
      await prisma.jobRunAttempt
        .updateMany({
          where: { jobRunId, attemptNo: j.attemptCount, status: JobRunAttemptStatus.RUNNING },
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
      await emitJobRunState(jobRunId).catch(() => {})
    }
  }
}

export async function recoverExpiredLeases() {
  // Crash recovery:
  // If we claimed a JobRun (status RUNNING) but never successfully attached a runId
  // and the lease has expired, requeue it (or mark FAILED if attempts exhausted).
  const now = new Date()
  const stuck = await prisma.jobRun.findMany({
    where: {
      status: JobRunStatus.RUNNING,
      runId: null,
      leaseExpiresAt: { not: null, lt: now },
    },
    orderBy: [{ leaseExpiresAt: "asc" }],
    take: SQLITE_TICK_RECOVER_EXPIRED_LEASES_TAKE,
    select: {
      id: true,
      attemptCount: true,
      maxAttempts: true,
      leaseExpiresAt: true,
      claimedAt: true,
      claimedBy: true,
    },
  })
  if (stuck.length === 0) return

  for (const j of stuck) {
    const msg = `lease expired before run created (claimedBy=${j.claimedBy ?? "?"}, claimedAt=${j.claimedAt?.toISOString?.() ?? "?"})`
    const canRetry = j.attemptCount < j.maxAttempts
    if (canRetry) {
      const backoffMs = computeRetryBackoffMs(j.attemptCount)
      // Use updateMany to avoid racing with a successful run creation in another tick.
      await prisma.jobRun
        .updateMany({
          where: { id: j.id, status: JobRunStatus.RUNNING, runId: null, leaseExpiresAt: { not: null, lt: now } },
          data: {
            status: JobRunStatus.QUEUED,
            queuedAt: now,
            nextAttemptAt: new Date(now.getTime() + backoffMs),
            lastErrorCode: "LEASE_EXPIRED",
            lastErrorMessage: msg,
            lastErrorMetaJson: safeJsonStringify({
              claimedBy: j.claimedBy ?? null,
              claimedAt: j.claimedAt?.toISOString?.() ?? null,
              leaseExpiresAt: j.leaseExpiresAt?.toISOString?.() ?? null,
            }),
            lastErrorAt: now,
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
            startedAt: null,
            finishedAt: null,
          },
        })
        .catch(() => {})
      await emitJobRunState(j.id).catch(() => {})
      await prisma.jobRunAttempt
        .updateMany({
          where: { jobRunId: j.id, attemptNo: j.attemptCount, status: JobRunAttemptStatus.RUNNING },
          data: {
            status: JobRunAttemptStatus.ABANDONED,
            finishedAt: now,
            errorCode: "LEASE_EXPIRED",
            errorMessage: msg,
            errorMetaJson: safeJsonStringify({
              claimedBy: j.claimedBy ?? null,
              claimedAt: j.claimedAt?.toISOString?.() ?? null,
              leaseExpiresAt: j.leaseExpiresAt?.toISOString?.() ?? null,
            }),
            errorAt: now,
          },
        })
        .catch(() => {})
    } else {
      await prisma.jobRun
        .updateMany({
          where: { id: j.id, status: JobRunStatus.RUNNING, runId: null, leaseExpiresAt: { not: null, lt: now } },
          data: {
            status: JobRunStatus.FAILED,
            finishedAt: now,
            lastErrorCode: "LEASE_EXPIRED",
            lastErrorMessage: msg,
            lastErrorMetaJson: safeJsonStringify({
              claimedBy: j.claimedBy ?? null,
              claimedAt: j.claimedAt?.toISOString?.() ?? null,
              leaseExpiresAt: j.leaseExpiresAt?.toISOString?.() ?? null,
            }),
            lastErrorAt: now,
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
          },
        })
        .catch(() => {})
      await emitJobRunState(j.id).catch(() => {})
      await prisma.jobRunAttempt
        .updateMany({
          where: { jobRunId: j.id, attemptNo: j.attemptCount, status: JobRunAttemptStatus.RUNNING },
          data: {
            status: JobRunAttemptStatus.FAILED,
            finishedAt: now,
            errorCode: "LEASE_EXPIRED",
            errorMessage: msg,
            errorMetaJson: safeJsonStringify({
              claimedBy: j.claimedBy ?? null,
              claimedAt: j.claimedAt?.toISOString?.() ?? null,
              leaseExpiresAt: j.leaseExpiresAt?.toISOString?.() ?? null,
            }),
            errorAt: now,
          },
        })
        .catch(() => {})
    }
  }
}

export async function reconcileJobRunsWithTerminalRuns() {
  // Crash recovery / reconciliation:
  // If a JobRun is RUNNING and has a runId, but the run is already terminal,
  // ensure the JobRun is transitioned accordingly (including retry/backoff on failure).
  //
  const jobs = await prisma.jobRun.findMany({
    where: { status: JobRunStatus.RUNNING, runId: { not: null } },
    orderBy: [{ startedAt: "asc" }],
    take: SQLITE_TICK_RECONCILE_JOB_RUNS_TAKE,
    select: {
      id: true,
      runId: true,
      attemptCount: true,
      maxAttempts: true,
      cancelRequestedAt: true,
      cancelRequestedReason: true,
    },
  })
  if (jobs.length === 0) return

  const runIds = jobs.map((j) => String(j.runId))
  const runs = await prisma.run.findMany({
    where: { id: { in: runIds } },
    select: { id: true, status: true, finishedAt: true, cancelRequestedAt: true, cancelRequestedReason: true },
  })
  const runMap = new Map(runs.map((r) => [String(r.id), r]))

  const terminal = new Set<RunStatus>([RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELED])
  const now = new Date()

  for (const j of jobs) {
    const runId = String(j.runId)
    const r = runMap.get(runId)
    if (!r) continue
    const st = r.status as RunStatus
    if (!terminal.has(st)) continue

    if (st === RunStatus.FAILED) {
      const canRetry = j.attemptCount < j.maxAttempts
      const stepFailure = await bestEffortRunStepFailure(runId)
      const jobErrorMessage = stepFailure ? `step ${stepFailure.stepKey} failed` : `run failed: ${runId}`
      const stepMetaObj = stepFailure?.stepErrorMetaJson ? safeJsonParseObject(stepFailure.stepErrorMetaJson) : null
      const timeoutMs = typeof stepMetaObj?.timeoutMs === "number" ? Number(stepMetaObj.timeoutMs) : null
      const signal = typeof stepMetaObj?.signal === "string" ? String(stepMetaObj.signal) : null
      const jobErrorMetaJson = stepFailure
        ? safeJsonStringify({
            runId,
            stepKey: stepFailure.stepKey,
            attemptNo: stepFailure.attemptNo,
            stepErrorCode: stepFailure.stepErrorCode,
            stepErrorMessage: stepFailure.stepErrorMessage,
            stepErrorMetaJson: stepFailure.stepErrorMetaJson,
            timeoutMs,
            signal,
            exitCode: stepFailure.exitCode,
          })
        : safeJsonStringify({ runId })
      if (canRetry) {
        const backoffMs = computeRetryBackoffMs(j.attemptCount)
        await prisma.jobRun
          .updateMany({
            where: { id: j.id, status: JobRunStatus.RUNNING, runId },
            data: {
              status: JobRunStatus.QUEUED,
              queuedAt: now,
              nextAttemptAt: new Date(now.getTime() + backoffMs),
              lastErrorCode: "RUN_STEP_FAILED",
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
        await emitJobRunState(j.id).catch(() => {})
        await prisma.jobRunAttempt
          .updateMany({
            where: { jobRunId: j.id, attemptNo: j.attemptCount, status: JobRunAttemptStatus.RUNNING },
            data: {
              status: JobRunAttemptStatus.FAILED,
              finishedAt: r.finishedAt ?? now,
              errorCode: "RUN_STEP_FAILED",
              errorMessage: jobErrorMessage,
              errorMetaJson: jobErrorMetaJson,
              errorAt: r.finishedAt ?? now,
            },
          })
          .catch(() => {})
      } else {
        await prisma.jobRun
          .updateMany({
            where: { id: j.id, status: JobRunStatus.RUNNING, runId },
            data: {
              status: JobRunStatus.FAILED,
              finishedAt: r.finishedAt ?? now,
              lastErrorCode: "RUN_STEP_FAILED",
              lastErrorMessage: jobErrorMessage,
              lastErrorMetaJson: jobErrorMetaJson,
              lastErrorAt: r.finishedAt ?? now,
              leaseExpiresAt: null,
            },
          })
          .catch(() => {})
        await emitJobRunState(j.id).catch(() => {})
        await prisma.jobRunAttempt
          .updateMany({
            where: { jobRunId: j.id, attemptNo: j.attemptCount, status: JobRunAttemptStatus.RUNNING },
            data: {
              status: JobRunAttemptStatus.FAILED,
              finishedAt: r.finishedAt ?? now,
              errorCode: "RUN_STEP_FAILED",
              errorMessage: jobErrorMessage,
              errorMetaJson: jobErrorMetaJson,
              errorAt: r.finishedAt ?? now,
            },
          })
          .catch(() => {})
      }
    } else if (st === RunStatus.SUCCEEDED) {
      await prisma.jobRun
        .updateMany({
          where: { id: j.id, status: JobRunStatus.RUNNING, runId },
          data: {
            status: JobRunStatus.SUCCEEDED,
            finishedAt: r.finishedAt ?? now,
            leaseExpiresAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastErrorMetaJson: null,
            lastErrorAt: null,
          },
        })
        .catch(() => {})
      await emitJobRunState(j.id).catch(() => {})
      await prisma.jobRunAttempt
        .updateMany({
          where: { jobRunId: j.id, attemptNo: j.attemptCount, status: JobRunAttemptStatus.RUNNING },
          data: { status: JobRunAttemptStatus.SUCCEEDED, finishedAt: r.finishedAt ?? now },
        })
        .catch(() => {})
    } else if (st === RunStatus.CANCELED) {
      await prisma.jobRun
        .updateMany({
          where: { id: j.id, status: JobRunStatus.RUNNING, runId },
          data: {
            status: JobRunStatus.CANCELED,
            finishedAt: r.finishedAt ?? now,
            leaseExpiresAt: null,
            cancelRequestedAt: j.cancelRequestedAt ?? r.cancelRequestedAt ?? now,
            cancelRequestedReason: j.cancelRequestedReason ?? r.cancelRequestedReason ?? null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastErrorMetaJson: null,
            lastErrorAt: null,
          },
        })
        .catch(() => {})
      await emitJobRunState(j.id).catch(() => {})
      await prisma.jobRunAttempt
        .updateMany({
          where: { jobRunId: j.id, attemptNo: j.attemptCount, status: JobRunAttemptStatus.RUNNING },
          data: {
            status: JobRunAttemptStatus.CANCELED,
            finishedAt: r.finishedAt ?? now,
            errorCode: null,
            errorMessage: null,
            errorMetaJson: null,
            errorAt: null,
          },
        })
        .catch(() => {})
    }
  }
}

export async function processQueuedJobRuns(params: {
  globalRunConcurrency: number
  claimJobRunAndCreateRun: (jobRunId: string) => Promise<void>
}) {
  const runningCount = await prisma.jobRun.count({ where: { status: JobRunStatus.RUNNING } })
  const slots = Math.max(0, params.globalRunConcurrency - runningCount)
  if (slots <= 0) return

  const now = new Date()
  const take = Math.min(500, Math.max(slots * 10, slots))
  const candidates = await prisma.jobRun.findMany({
    where: {
      status: JobRunStatus.QUEUED,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ queuedAt: "asc" }],
    take,
    select: { id: true, batchId: true },
  })

  const batchIds = Array.from(
    new Set(candidates.map((c) => c.batchId).filter((v): v is string => typeof v === "string" && v.length > 0)),
  )
  const batchMetaSelect = {
    id: true,
    concurrencyLimit: true,
    startedAt: true,
    rampUpSeconds: true,
    autoMaxConcurrency: true,
  } satisfies Prisma.BatchSelect

  type BatchMeta = Prisma.BatchGetPayload<{ select: typeof batchMetaSelect }>

  const batchMeta: BatchMeta[] =
    batchIds.length > 0
      ? await prisma.batch.findMany({
          where: { id: { in: batchIds } },
          select: batchMetaSelect,
        })
      : []

  function effectiveLimit(b: BatchMeta) {
    const manual =
      typeof b.concurrencyLimit === "number" && Number.isFinite(b.concurrencyLimit)
        ? Math.floor(b.concurrencyLimit)
        : null
    if (manual != null && manual > 0) return manual

    const rampSeconds =
      typeof b.rampUpSeconds === "number" && Number.isFinite(b.rampUpSeconds)
        ? Math.max(1, Math.floor(b.rampUpSeconds))
        : null
    const autoMax =
      typeof b.autoMaxConcurrency === "number" && Number.isFinite(b.autoMaxConcurrency)
        ? Math.max(1, Math.floor(b.autoMaxConcurrency))
        : null
    if (rampSeconds == null || autoMax == null) return null

    const anchor = b.startedAt instanceof Date ? b.startedAt : null
    const elapsedMs = anchor ? Math.max(0, Date.now() - anchor.getTime()) : 0
    const frac = Math.min(1, elapsedMs / (rampSeconds * 1000))
    const cap = Math.max(1, Math.min(autoMax, 1 + Math.floor(frac * (autoMax - 1))))
    return cap
  }

  const limitByBatchId = new Map<string, number | null>(batchMeta.map((b) => [b.id, effectiveLimit(b)]))

  const runningByBatch =
    batchIds.length > 0
      ? await prisma.jobRun.groupBy({
          by: ["batchId"],
          where: { batchId: { in: batchIds }, status: JobRunStatus.RUNNING },
          _count: { _all: true },
        })
      : []
  const runningCountByBatchId = new Map<string, number>(
    runningByBatch
      .map((r) => [typeof r.batchId === "string" ? r.batchId : null, Number(r._count?._all ?? 0)] as const)
      .filter((p): p is readonly [string, number] => typeof p[0] === "string"),
  )

  let started = 0
  for (const c of candidates) {
    if (started >= slots) break
    const bid = c.batchId
    if (typeof bid === "string" && bid.length) {
      const limit = limitByBatchId.get(bid) ?? null
      if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
        const cur = runningCountByBatchId.get(bid) ?? 0
        if (cur >= limit) continue
        runningCountByBatchId.set(bid, cur + 1)
      }
    }
    await params.claimJobRunAndCreateRun(c.id)
    started += 1
  }
}

export async function claimJobRunAndCreateRun(params: {
  jobRunId: string
  engineId: string
  createRunFromJobRun: (tx: Prisma.TransactionClient, args: { jobRunId: string; now: Date }) => Promise<{ id: string }>
}) {
  const jobRunId = params.jobRunId
  const now = new Date()
  const touched = await prisma
    .$transaction(async (tx) => {
      const claim = await tx.jobRun.updateMany({
        where: {
          id: jobRunId,
          status: JobRunStatus.QUEUED,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        data: {
          status: JobRunStatus.RUNNING,
          claimedBy: params.engineId,
          claimedAt: now,
          startedAt: now,
          leaseExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
          attemptCount: { increment: 1 },
          nextAttemptAt: null,
          finishedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorMetaJson: null,
          lastErrorAt: null,
        },
      })
      if (claim.count !== 1) return false

      // Fetch the current attemptCount after claim (attemptCount is incremented when claiming).
      const claimedJob = await tx.jobRun.findUnique({
        where: { id: jobRunId },
        select: { id: true, attemptCount: true },
      })
      if (!claimedJob) return false

      // Create an attempt audit record.
      await tx.jobRunAttempt.create({
        data: {
          id: crypto.randomUUID(),
          jobRunId,
          attemptNo: claimedJob.attemptCount,
          status: JobRunAttemptStatus.RUNNING,
          startedAt: now,
        },
        select: { id: true },
      })

      try {
        const run = await params.createRunFromJobRun(tx, { jobRunId, now })
        await tx.jobRun.update({
          where: { id: jobRunId },
          data: { runId: run.id },
          select: { id: true },
        })
        // Attach runId to the attempt record (best-effort).
        await tx.jobRunAttempt.updateMany({
          where: { jobRunId, attemptNo: claimedJob.attemptCount, status: JobRunAttemptStatus.RUNNING },
          data: { runId: run.id },
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const job = await tx.jobRun.findUnique({
          where: { id: jobRunId },
          select: { id: true, attemptCount: true, maxAttempts: true },
        })
        if (!job) return true

        const canRetry = job.attemptCount < job.maxAttempts
        if (canRetry) {
          const backoffMs = computeRetryBackoffMs(job.attemptCount)
          await tx.jobRun.update({
            where: { id: jobRunId },
            data: {
              status: JobRunStatus.QUEUED,
              queuedAt: now,
              nextAttemptAt: new Date(now.getTime() + backoffMs),
              lastErrorCode: "RUN_CREATE_FAILED",
              lastErrorMessage: `create run failed: ${msg}`,
              lastErrorMetaJson: safeJsonStringify({ detail: msg }),
              lastErrorAt: now,
              runId: null,
              claimedBy: null,
              claimedAt: null,
              leaseExpiresAt: null,
            },
          })
          await tx.jobRunAttempt.updateMany({
            where: { jobRunId, attemptNo: job.attemptCount, status: JobRunAttemptStatus.RUNNING },
            data: {
              status: JobRunAttemptStatus.FAILED,
              finishedAt: now,
              errorCode: "RUN_CREATE_FAILED",
              errorMessage: `create run failed: ${msg}`,
              errorMetaJson: safeJsonStringify({ detail: msg }),
              errorAt: now,
            },
          })
        } else {
          await tx.jobRun.update({
            where: { id: jobRunId },
            data: {
              status: JobRunStatus.FAILED,
              finishedAt: now,
              lastErrorCode: "RUN_CREATE_FAILED",
              lastErrorMessage: `create run failed: ${msg}`,
              lastErrorMetaJson: safeJsonStringify({ detail: msg }),
              lastErrorAt: now,
              runId: null,
              claimedBy: null,
              claimedAt: null,
              leaseExpiresAt: null,
            },
          })
          await tx.jobRunAttempt.updateMany({
            where: { jobRunId, attemptNo: job.attemptCount, status: JobRunAttemptStatus.RUNNING },
            data: {
              status: JobRunAttemptStatus.FAILED,
              finishedAt: now,
              errorCode: "RUN_CREATE_FAILED",
              errorMessage: `create run failed: ${msg}`,
              errorMetaJson: safeJsonStringify({ detail: msg }),
              errorAt: now,
            },
          })
        }

        console.error("[engine] createRunFromJobRun failed", { jobRunId, msg })
      }
      return true
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[engine] claimJobRunAndCreateRun transaction failed", { jobRunId, msg })
      return false
    })

  // Emit a generic realtime event after commit so SSE consumers can update without polling.
  if (touched) {
    await emitJobRunState(jobRunId).catch(() => {})
  }
}

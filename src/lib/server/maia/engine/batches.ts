import "server-only"

import { BatchStatus, JobRunStatus, type Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { safeJsonStringify } from "@/lib/server/maia/engine/helpers"
import { emitBatchState } from "@/lib/server/maia/realtime"

const SQLITE_TICK_BATCHES_TAKE = 25

export async function rollupBatches() {
  const batchSelect = {
    id: true,
    publicId: true,
    status: true,
    startedAt: true,
    failFast: true,
    maxFailures: true,
  } satisfies Prisma.BatchSelect

  type BatchRow = Prisma.BatchGetPayload<{ select: typeof batchSelect }>

  const batches: BatchRow[] = await prisma.batch.findMany({
    where: { status: { in: [BatchStatus.CREATED, BatchStatus.PAUSED, BatchStatus.RUNNING] } },
    orderBy: [{ updatedAt: "asc" }],
    take: SQLITE_TICK_BATCHES_TAKE,
    select: batchSelect,
  })
  if (batches.length === 0) return

  for (const b of batches) {
    const counts = await prisma.jobRun.groupBy({
      by: ["status"],
      where: { batchId: b.id },
      _count: { _all: true },
    })
    const map = new Map<JobRunStatus, number>(counts.map((r) => [r.status, r._count._all]))
    const total = Array.from(map.values()).reduce((a, n) => a + n, 0)
    if (total === 0) continue

    const active = (map.get(JobRunStatus.RUNNING) ?? 0) + (map.get(JobRunStatus.QUEUED) ?? 0)
    const paused = map.get(JobRunStatus.PAUSED) ?? 0
    const failed = map.get(JobRunStatus.FAILED) ?? 0
    const succeeded = map.get(JobRunStatus.SUCCEEDED) ?? 0
    const canceled = map.get(JobRunStatus.CANCELED) ?? 0
    const terminal = failed + succeeded + canceled

    const maxFailures =
      typeof b.maxFailures === "number" && Number.isFinite(b.maxFailures)
        ? Math.max(1, Math.floor(b.maxFailures))
        : null
    const failFast = b.failFast === true
    const shouldCancelRemaining = (failFast && failed > 0) || (maxFailures != null && failed >= maxFailures)

    // Fail policy: request cancellation for remaining non-terminal jobs.
    if (shouldCancelRemaining && terminal < total) {
      const now = new Date()
      await prisma.jobRun
        .updateMany({
          where: {
            batchId: b.id,
            status: { in: [JobRunStatus.QUEUED, JobRunStatus.PAUSED, JobRunStatus.RUNNING] },
            cancelRequestedAt: null,
          },
          data: {
            cancelRequestedAt: now,
            cancelRequestedReason: failFast ? "fail_fast" : "fail_threshold",
          },
        })
        .catch(() => {})
    }

    if (active > 0) {
      const shouldSetStartedAt = !b.startedAt
      const shouldSetRunning = b.status !== BatchStatus.RUNNING
      if (shouldSetRunning || shouldSetStartedAt) {
        await prisma.batch
          .updateMany({
            where: { id: b.id, status: { in: [BatchStatus.CREATED, BatchStatus.PAUSED, BatchStatus.RUNNING] } },
            data: {
              status: BatchStatus.RUNNING,
              startedAt: b.startedAt ?? new Date(),
              failureCode: null,
              failureMessage: null,
              failureMetaJson: null,
              failureAt: null,
            },
          })
          .catch(() => {})
        await emitBatchState({
          batchId: String(b.publicId ?? b.id),
          status: "RUNNING",
          startedAt: (b.startedAt ?? new Date()).toISOString(),
          jobsTotal: total,
          jobsByStatus: Object.fromEntries(map.entries()),
        }).catch(() => {})
      }
      continue
    }

    // No active jobs left; if there are paused jobs, the batch is paused (not running).
    if (paused > 0 && terminal < total) {
      const shouldSetPaused = b.status !== BatchStatus.PAUSED
      if (shouldSetPaused) {
        await prisma.batch
          .updateMany({
            where: { id: b.id, status: { in: [BatchStatus.CREATED, BatchStatus.RUNNING, BatchStatus.PAUSED] } },
            data: { status: BatchStatus.PAUSED },
          })
          .catch(() => {})
        await emitBatchState({
          batchId: String(b.publicId ?? b.id),
          status: "PAUSED",
          startedAt: b.startedAt ? b.startedAt.toISOString() : null,
          jobsTotal: total,
          jobsByStatus: Object.fromEntries(map.entries()),
        }).catch(() => {})
      }
      continue
    }

    if (terminal === total) {
      const status: BatchStatus =
        failed > 0
          ? BatchStatus.FAILED
          : succeeded === total
            ? BatchStatus.SUCCEEDED
            : canceled === total
              ? BatchStatus.CANCELED
              : BatchStatus.FAILED
      const finishedAt = new Date()
      const failure =
        status === BatchStatus.FAILED
          ? {
              code: "JOB_FAILED",
              message: "One or more jobs failed",
              meta: { failedJobs: failed, totalJobs: total },
            }
          : status === BatchStatus.CANCELED
            ? { code: "CANCELED", message: "Batch canceled", meta: { canceledJobs: canceled, totalJobs: total } }
            : null
      await prisma.batch
        .update({
          where: { id: b.id },
          data: {
            status,
            finishedAt,
            failureCode: failure?.code ?? null,
            failureMessage: failure?.message ?? null,
            failureMetaJson: failure ? safeJsonStringify(failure.meta) : null,
            failureAt: failure ? finishedAt : null,
          },
        })
        .catch(() => {})
      await emitBatchState({
        batchId: String(b.publicId ?? b.id),
        status,
        startedAt: b.startedAt ? b.startedAt.toISOString() : null,
        finishedAt: finishedAt.toISOString(),
        jobsTotal: total,
        jobsByStatus: Object.fromEntries(map.entries()),
      }).catch(() => {})
    }
  }
}

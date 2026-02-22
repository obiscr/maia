import "server-only"

import { JobRunStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import type { RequestAuthContext } from "@/lib/server/authz"
import { isAdmin } from "@/lib/server/authz"

async function findOwnedBatch(auth: RequestAuthContext, batchId: string) {
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  const batch = await prisma.batch.findFirst({
    where: { publicId: batchPublicId, ...(isAdmin(auth) ? {} : { ownerUserId: auth.userId }) },
    select: { id: true, startedAt: true },
  })
  return { batch, batchPublicId }
}

export async function pauseBatch(auth: RequestAuthContext, batchId: string) {
  const { batch, batchPublicId } = await findOwnedBatch(auth, batchId)
  if (!batch) return { ok: false as const, code: "NOT_FOUND" as const }
  const updated = await prisma.jobRun.updateMany({
    where: { batchId: batch.id, status: JobRunStatus.QUEUED },
    data: { status: JobRunStatus.PAUSED },
  })
  return { ok: true as const, paused: updated.count, batchPublicId }
}

export async function resumeBatch(auth: RequestAuthContext, batchId: string) {
  const { batch, batchPublicId } = await findOwnedBatch(auth, batchId)
  if (!batch) return { ok: false as const, code: "NOT_FOUND" as const }
  const now = new Date()
  const updated = await prisma.jobRun.updateMany({
    where: { batchId: batch.id, status: JobRunStatus.PAUSED },
    data: {
      status: JobRunStatus.QUEUED,
      queuedAt: now,
      nextAttemptAt: null,
      finishedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorMetaJson: null,
      lastErrorAt: null,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      startedAt: null,
      runId: null,
    },
  })
  if (!batch.startedAt) {
    await prisma.batch
      .updateMany({ where: { id: batch.id, startedAt: null }, data: { startedAt: now } })
      .catch(() => {})
  }
  const eng = await ensureEngineRunning()
  void eng.tick({ priority: "low", reason: "batches:resume" })
  return { ok: true as const, resumed: updated.count, batchPublicId }
}

export async function cancelBatch(auth: RequestAuthContext, batchId: string) {
  const { batch, batchPublicId } = await findOwnedBatch(auth, batchId)
  if (!batch) return { ok: false as const, code: "NOT_FOUND" as const }
  const now = new Date()
  const reason = "batch_cancel"
  const canceledImmediate = await prisma.jobRun.updateMany({
    where: { batchId: batch.id, status: { in: [JobRunStatus.QUEUED, JobRunStatus.PAUSED] } },
    data: {
      status: JobRunStatus.CANCELED,
      cancelRequestedAt: now,
      cancelRequestedReason: reason,
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
  const cancelRequested = await prisma.jobRun.updateMany({
    where: { batchId: batch.id, status: JobRunStatus.RUNNING, cancelRequestedAt: null },
    data: { cancelRequestedAt: now, cancelRequestedReason: reason },
  })
  const eng = await ensureEngineRunning()
  void eng.tick({ priority: "high", reason: "batches:cancel" })
  return {
    ok: true as const,
    canceledImmediate: canceledImmediate.count,
    cancelRequested: cancelRequested.count,
    batchPublicId,
  }
}

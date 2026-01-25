import { prisma } from "@/lib/server/db"
import { withApiObservability, mark } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { notFound } from "@/lib/server/http/response"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { JobRunStatus } from "@prisma/client"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  const batch = await prisma.batch.findFirst({
    where: { publicId: batchPublicId, ...(isAdmin(auth) ? {} : { ownerUserId: auth.userId }) },
    select: { id: true },
  })
  if (!batch) return notFound("NOT_FOUND")

  return await runIdempotentOperation({
    req,
    action: "BATCH_CANCEL",
    scope: `batches:${batchPublicId}:cancel`,
    targetType: "batch",
    targetId: batchPublicId,
    exec: async ({ operationId }) => {
      const now = new Date()
      const reason = "batch_cancel"

      // Fast-path: queued/paused jobs can be canceled immediately.
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

      // RUNNING jobs need cooperative cancellation.
      const cancelRequested = await prisma.jobRun.updateMany({
        where: { batchId: batch.id, status: JobRunStatus.RUNNING, cancelRequestedAt: null },
        data: { cancelRequestedAt: now, cancelRequestedReason: reason },
      })

      const eng = await ensureEngineRunning()
      mark("engine")
      void eng.tick({ priority: "high", reason: "batches:cancel" })
      mark("engine.tick")

      return {
        status: 200,
        body: {
          ok: true,
          canceledImmediate: canceledImmediate.count,
          cancelRequested: cancelRequested.count,
          operationId,
        },
      }
    },
  })
})

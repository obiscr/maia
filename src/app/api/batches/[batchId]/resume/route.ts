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
    select: { id: true, startedAt: true },
  })
  if (!batch) return notFound("NOT_FOUND")

  return await runIdempotentOperation({
    req,
    action: "BATCH_RESUME",
    scope: `batches:${batchPublicId}:resume`,
    targetType: "batch",
    targetId: batchPublicId,
    exec: async ({ operationId }) => {
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

      // Mark the batch as started once we resume (best-effort; rollup will correct status).
      if (!batch.startedAt) {
        await prisma.batch
          .updateMany({ where: { id: batch.id, startedAt: null }, data: { startedAt: now } })
          .catch(() => {})
      }

      const eng = await ensureEngineRunning()
      mark("engine")
      void eng.tick({ priority: "low", reason: "batches:resume" })
      mark("engine.tick")

      return { status: 200, body: { ok: true, resumed: updated.count, operationId } }
    },
  })
})

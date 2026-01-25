import { prisma } from "@/lib/server/db"
import { withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { notFound } from "@/lib/server/http/response"
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
    action: "BATCH_PAUSE",
    scope: `batches:${batchPublicId}:pause`,
    targetType: "batch",
    targetId: batchPublicId,
    exec: async ({ operationId }) => {
      const updated = await prisma.jobRun.updateMany({
        where: { batchId: batch.id, status: JobRunStatus.QUEUED },
        data: { status: JobRunStatus.PAUSED },
      })
      return { status: 200, body: { ok: true, paused: updated.count, operationId } }
    },
  })
})

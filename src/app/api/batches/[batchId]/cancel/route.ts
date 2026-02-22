import { withApiObservability, mark } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { notFound } from "@/lib/server/http/response"
import { requireRequestAuth } from "@/lib/server/authz"
import { cancelBatch } from "@/lib/server/services/batches/control-batch"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  const batch = await cancelBatch(auth, batchPublicId)
  if (!batch.ok) return notFound("NOT_FOUND")

  return await runIdempotentOperation({
    req,
    action: "BATCH_CANCEL",
    scope: `batches:${batchPublicId}:cancel`,
    targetType: "batch",
    targetId: batchPublicId,
    exec: async ({ operationId }) => {
      const result = await cancelBatch(auth, batchPublicId)
      if (!result.ok) return { status: 404, body: { code: "NOT_FOUND" } }
      mark("engine.tick")

      return {
        status: 200,
        body: {
          ok: true,
          canceledImmediate: result.canceledImmediate,
          cancelRequested: result.cancelRequested,
          operationId,
        },
      }
    },
  })
})

import { withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { notFound } from "@/lib/server/http/response"
import { requireRequestAuth } from "@/lib/server/authz"
import { pauseBatch } from "@/lib/server/services/batches/control-batch"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  const batch = await pauseBatch(auth, batchPublicId)
  if (!batch.ok) return notFound("NOT_FOUND")

  return await runIdempotentOperation({
    req,
    action: "BATCH_PAUSE",
    scope: `batches:${batchPublicId}:pause`,
    targetType: "batch",
    targetId: batchPublicId,
    exec: async ({ operationId }) => {
      const result = await pauseBatch(auth, batchPublicId)
      if (!result.ok) return { status: 404, body: { code: "NOT_FOUND" } }
      return { status: 200, body: { ok: true, paused: result.paused, operationId } }
    },
  })
})

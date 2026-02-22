import { z } from "zod"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { requireRequestAuth } from "@/lib/server/authz"
import { fanoutBatchSchema, startBatchFanout } from "@/lib/server/services/batches/fanout-batch"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  return await runIdempotentOperation({
    req,
    action: "BATCH_FANOUT",
    scope: `batches:${batchPublicId}:fanout`,
    targetType: "batch",
    targetId: batchPublicId,
    exec: async ({ operationId, operationInternalId }) => {
      let body: z.infer<typeof fanoutBatchSchema>
      try {
        body = fanoutBatchSchema.parse(await req.json())
      } catch (e) {
        if (e instanceof z.ZodError) return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
        throw e
      }
      const started = await startBatchFanout({
        auth,
        batchId: batchPublicId,
        operationId,
        operationInternalId,
        body,
      })
      if (!started.ok) {
        return {
          status: started.status,
          body: { code: started.code, issues: started.issues, meta: started.meta },
        }
      }
      return { status: started.status, body: started.body }
    },
  })
})

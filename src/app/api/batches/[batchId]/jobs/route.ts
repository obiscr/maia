import { z } from "zod"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { requireRequestAuth } from "@/lib/server/authz"
import { createBatchJobs, createBatchJobsSchema } from "@/lib/server/services/batches/create-batch-jobs"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  return await runIdempotentOperation({
    req,
    action: "BATCH_JOBS_CREATE",
    scope: `batches:${batchPublicId}:jobs:create`,
    targetType: "batch",
    targetId: batchPublicId,
    exec: async ({ operationId, operationInternalId }) => {
      let body: z.infer<typeof createBatchJobsSchema>
      try {
        body = createBatchJobsSchema.parse(await req.json())
      } catch (e) {
        if (e instanceof z.ZodError) return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
        throw e
      }

      const created = await createBatchJobs({
        auth,
        batchId: batchPublicId,
        operationId,
        operationInternalId,
        body,
      })
      if (!created.ok) return { status: created.status, body: { code: created.code } }
      return { status: created.status, body: created.body }
    },
  })
})

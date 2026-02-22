import { mark, withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { resumeJobByPublicId } from "@/lib/server/services/jobs/resume-job"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { jobId } = await ctx.params
  const jobPublicId = String(jobId || "")
    .trim()
    .toLowerCase()
  return await runIdempotentOperation({
    req,
    action: "JOB_RESUME",
    scope: `jobs:${jobPublicId}:resume`,
    targetType: "job",
    targetId: jobPublicId,
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      const resumed = await resumeJobByPublicId({ auth, viewerAuth, jobId: jobPublicId })
      if (!resumed.ok) {
        if (resumed.code === "NOT_FOUND") return { status: 404, body: { code: "NOT_FOUND" } }
        if (resumed.code === "JOB_NOT_PAUSED") return { status: 409, body: { code: "JOB_NOT_PAUSED" } }
      }
      mark("engine.tick")

      return { status: 200, body: { ok: true, operationId } }
    },
  })
})

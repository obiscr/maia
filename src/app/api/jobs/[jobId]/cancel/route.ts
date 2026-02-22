import { mark, withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { notFound } from "@/lib/server/http/response"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { cancelJobByPublicId } from "@/lib/server/services/jobs/cancel-job"
import { getJobByPublicId } from "@/lib/server/services/jobs/get-job"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { jobId } = await ctx.params
  const jobPublicId = String(jobId || "")
    .trim()
    .toLowerCase()
  const job = await getJobByPublicId({ viewerAuth, jobId: jobPublicId })
  if (!job) return notFound("NOT_FOUND")
  return await runIdempotentOperation({
    req,
    action: "JOB_CANCEL",
    scope: `jobs:${jobPublicId}:cancel`,
    targetType: "job",
    targetId: jobPublicId,
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      let reason: string | null = null
      try {
        const ct = req.headers.get("content-type") || ""
        if (ct.includes("application/json")) {
          const body: unknown = await req.json().catch(() => null)
          if (body && typeof body === "object" && typeof (body as Record<string, unknown>).reason === "string") {
            reason = String((body as Record<string, unknown>).reason)
          }
        }
      } catch {
        reason = null
      }
      const canceled = await cancelJobByPublicId({ viewerAuth, jobId: jobPublicId, reason })
      if (!canceled.ok) return { status: 404, body: { code: "NOT_FOUND" } }
      mark("engine.cancel_requested")
      return { status: 200, body: { ok: true, operationId } }
    },
  })
})

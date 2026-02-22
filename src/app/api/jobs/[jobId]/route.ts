import { notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { deleteJobByPublicId } from "@/lib/server/services/jobs/delete-job"
import { getJobByPublicId } from "@/lib/server/services/jobs/get-job"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { jobId } = await ctx.params
  const job = await getJobByPublicId({ viewerAuth, jobId })
  if (!job) return notFound("NOT_FOUND")
  return ok({ job })
})

export const DELETE = withApiObservability(async (_req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { jobId } = await ctx.params
  const result = await deleteJobByPublicId({ viewerAuth, jobId })
  if (!result.ok) return notFound("NOT_FOUND")
  return ok({ ok: true })
})

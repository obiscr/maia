import { fail, notFound, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { deleteRunByPublicId } from "@/lib/server/services/runs/delete-run"
import { getRunByPublicId } from "@/lib/server/services/runs/get-run"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
  const run = await getRunByPublicId({ viewerAuth, runId })
  if (!run) return notFound("RUN_NOT_FOUND")
  mark("sort.steps")
  return ok({ run })
})

export const DELETE = withApiObservability(async (_: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
  const result = await deleteRunByPublicId({ viewerAuth, runId })
  if (!result.ok && result.code === "RUN_NOT_FOUND") return notFound("RUN_NOT_FOUND")
  if (!result.ok && result.code === "RUN_IS_RUNNING") return fail({ status: 409, code: "RUN_IS_RUNNING" })
  mark("fs.rm")
  return ok({ ok: true })
})

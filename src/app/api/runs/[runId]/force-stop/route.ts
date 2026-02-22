import { mark, withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { notFound } from "@/lib/server/http/response"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { forceStopRunByPublicId } from "@/lib/server/services/runs/force-stop-run"
import { getRunByPublicId } from "@/lib/server/services/runs/get-run"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
  const runPublicId = String(runId || "")
    .trim()
    .toLowerCase()
  const run = await getRunByPublicId({ viewerAuth, runId: runPublicId })
  if (!run) return notFound("RUN_NOT_FOUND")
  return await runIdempotentOperation({
    req,
    action: "RUN_FORCE_STOP",
    scope: `runs:${runPublicId}:force-stop`,
    targetType: "run",
    targetId: runPublicId,
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      const stopped = await forceStopRunByPublicId({ viewerAuth, runId: runPublicId })
      if (!stopped.ok) return { status: 404, body: { code: "RUN_NOT_FOUND" } }
      mark("engine.force_stop")
      return { status: 200, body: { ok: true, operationId } }
    },
  })
})

import { ensureEngineRunning } from "@/lib/server/maia/server"
import { mark, withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { prisma } from "@/lib/server/db"
import { notFound } from "@/lib/server/http/response"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const POST = withApiObservability(
  async (req: Request, ctx: { params: Promise<{ runId: string; stepKey: string }> }) => {
    const auth = requireRequestAuth()
    const viewerAuth = toViewerAuthContext(auth)
    const { runId, stepKey } = await ctx.params
    const runPublicId = String(runId || "")
      .trim()
      .toLowerCase()
    const run = await prisma.run.findFirst({
      where: getRunFindFirstWhereByPublicId(viewerAuth, runPublicId),
      select: { id: true },
    })
    if (!run) return notFound("RUN_NOT_FOUND")
    return await runIdempotentOperation({
      req,
      action: "RUN_STEP_RERUN",
      scope: `runs:${runPublicId}:steps:${stepKey}:rerun`,
      targetType: "runStep",
      targetId: `${runPublicId}:${stepKey}`,
      exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
        const eng = await ensureEngineRunning()
        mark("engine")
        const res = await eng.rerunStep(run.id, stepKey)
        void eng.tick()
        mark("engine.rerun")
        mark("engine.tick")
        const newRun = await prisma.run.findUnique({ where: { id: res.newRunId }, select: { publicId: true } })
        return { status: 200, body: { ok: true, newRunId: String(newRun?.publicId ?? res.newRunId), operationId } }
      },
    })
  },
)

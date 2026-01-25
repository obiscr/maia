import { ensureEngineRunning } from "@/lib/server/maia/server"
import { mark, withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { prisma } from "@/lib/server/db"
import { notFound } from "@/lib/server/http/response"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
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
    action: "RUN_CANCEL",
    scope: `runs:${runPublicId}:cancel`,
    targetType: "run",
    targetId: runPublicId,
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
      const eng = await ensureEngineRunning()
      mark("engine")
      await eng.requestCancelRun({ runId: run.id, reason })
      mark("engine.cancel_requested")
      void eng.tick()
      mark("engine.tick")
      return { status: 200, body: { ok: true, operationId } }
    },
  })
})

import { ensureEngineRunning } from "@/lib/server/maia/server"
import { mark, withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { prisma } from "@/lib/server/db"
import { notFound } from "@/lib/server/http/response"
import { requireRequestAuth } from "@/lib/server/authz"
import { getJobRunFindFirstWhereByPublicId } from "@/lib/server/scopes/jobs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { jobId } = await ctx.params
  const jobPublicId = String(jobId || "")
    .trim()
    .toLowerCase()
  const job = await prisma.jobRun.findFirst({
    where: getJobRunFindFirstWhereByPublicId(viewerAuth, jobPublicId),
    select: { id: true },
  })
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

      const eng = await ensureEngineRunning()
      mark("engine")
      await eng.requestCancelJobRun({ jobRunId: job.id, reason })
      mark("engine.cancel_requested")
      void eng.tick()
      mark("engine.tick")
      return { status: 200, body: { ok: true, operationId } }
    },
  })
})

import { prisma } from "@/lib/server/db"
import { mark, withApiObservability } from "@/lib/server/observability"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { JobRunStatus } from "@prisma/client"
import { requireRequestAuth } from "@/lib/server/authz"
import { makeUpdateAudit } from "@/lib/server/audit/write"
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
  return await runIdempotentOperation({
    req,
    action: "JOB_RESUME",
    scope: `jobs:${jobPublicId}:resume`,
    targetType: "job",
    targetId: jobPublicId,
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      const job = await prisma.jobRun.findFirst({
        where: getJobRunFindFirstWhereByPublicId(viewerAuth, jobPublicId),
        select: { id: true, status: true },
      })
      if (!job) return { status: 404, body: { code: "NOT_FOUND" } }

      if (String(job.status) !== "PAUSED") {
        return { status: 409, body: { code: "JOB_NOT_PAUSED" } }
      }

      const now = new Date()
      const updated = await prisma.jobRun.updateMany({
        where: { id: job.id, status: JobRunStatus.PAUSED },
        data: {
          ...makeUpdateAudit(auth),
          status: JobRunStatus.QUEUED,
          queuedAt: now,
          nextAttemptAt: null,
          finishedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorMetaJson: null,
          lastErrorAt: null,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          startedAt: null,
          runId: null,
        },
      })

      if (updated.count !== 1) {
        // Race: job status changed between read and update.
        return { status: 409, body: { code: "JOB_NOT_PAUSED" } }
      }

      const eng = await ensureEngineRunning()
      mark("engine")
      void eng.tick()
      mark("engine.tick")

      return { status: 200, body: { ok: true, operationId } }
    },
  })
})

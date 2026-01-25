import { prisma } from "@/lib/server/db"
import { notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { getJobRunFindFirstWhereByPublicId } from "@/lib/server/scopes/jobs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
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

  const attempts = await prisma.jobRunAttempt.findMany({
    where: { jobRunId: job.id },
    orderBy: [{ attemptNo: "asc" }],
    select: {
      attemptNo: true,
      status: true,
      run: { select: { publicId: true, publicNumber: true, status: true } },
      errorCode: true,
      errorMessage: true,
      errorMetaJson: true,
      errorAt: true,
      startedAt: true,
      finishedAt: true,
    },
  })

  return ok({
    attempts: attempts.map((a) => ({
      // Avoid leaking internal UUIDs: no attempt.id, no jobRunId internal, no runId internal.
      id: `attempt:${a.attemptNo}`,
      jobRunId: jobPublicId,
      attemptNo: a.attemptNo,
      status: a.status,
      runId: a.run?.publicId ?? null,
      run: a.run
        ? {
            id: a.run.publicId,
            publicId: a.run.publicId,
            publicNumber: a.run.publicNumber,
            status: a.run.status,
          }
        : null,
      errorCode: a.errorCode ?? null,
      errorMessage: a.errorMessage ?? null,
      errorMetaJson: a.errorMetaJson ?? null,
      errorAt: a.errorAt ?? null,
      startedAt: a.startedAt ?? null,
      finishedAt: a.finishedAt ?? null,
    })),
  })
})

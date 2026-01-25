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
    select: {
      publicId: true,
      inputFiles: {
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          source: true,
          status: true,
          url: true,
          error: true,
          sha256: true,
          sizeBytes: true,
          mime: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })
  if (!job) return notFound("NOT_FOUND")

  return ok({
    jobId: job.publicId,
    inputFiles: job.inputFiles.map((f) => ({
      id: f.id,
      name: f.name,
      source: f.source,
      status: f.status,
      url: f.url ?? null,
      error: f.error ?? null,
      sha256: f.sha256 ?? null,
      sizeBytes: typeof f.sizeBytes === "number" ? f.sizeBytes : null,
      mime: f.mime ?? null,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })),
  })
})


import { prisma } from "@/lib/server/db"
import { notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
  const runPublicId = String(runId || "")
    .trim()
    .toLowerCase()

  const run = await prisma.run.findFirst({
    where: getRunFindFirstWhereByPublicId(viewerAuth, runPublicId),
    select: { id: true, publicId: true },
  })
  if (!run) return notFound("RUN_NOT_FOUND")

  const job = await prisma.jobRun.findFirst({
    where: { runId: run.id },
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

  // Runs might be created outside the JobRun engine path (e.g. legacy or future flows).
  if (!job) return ok({ runId: run.publicId, jobId: null, inputFiles: [] })

  return ok({
    runId: run.publicId,
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


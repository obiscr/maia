import { prisma } from "@/lib/server/db"
import { notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const GET = withApiObservability(async (req: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
  const runPublicId = String(runId || "")
    .trim()
    .toLowerCase()
  const url = new URL(req.url)
  const stepKey = (url.searchParams.get("stepKey") ?? "").trim() || null

  const run = await prisma.run.findFirst({
    where: getRunFindFirstWhereByPublicId(viewerAuth, runPublicId),
    select: { id: true },
  })
  if (!run) return notFound("RUN_NOT_FOUND")

  const artifacts = await prisma.artifact.findMany({
    where: { runId: run.id, ...(stepKey ? { stepKey } : {}) },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      stepKey: true,
      attemptNo: true,
      kind: true,
      path: true,
      sizeBytes: true,
      sha256: true,
      summary: true,
      createdAt: true,
    },
  })

  // NOTE: Artifact.id is currently the DB primary key (UUID). Fully removing UUIDs from artifacts
  // will require a schema-level public id, but we still avoid leaking internal runId, etc.
  return ok({
    artifacts: artifacts.map((a) => ({
      id: a.id,
      artifactInternalId: a.id,
      runId: runPublicId,
      stepKey: a.stepKey,
      attemptNo: a.attemptNo,
      kind: a.kind,
      path: a.path,
      sizeBytes: a.sizeBytes ?? null,
      sha256: a.sha256 ?? null,
      summary: a.summary ?? null,
      createdAt: a.createdAt,
    })),
  })
})

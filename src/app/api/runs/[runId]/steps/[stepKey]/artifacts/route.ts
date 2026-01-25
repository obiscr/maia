import { NextResponse } from "next/server"

import { prisma } from "@/lib/server/db"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const GET = withApiObservability(
  async (_: Request, ctx: { params: Promise<{ runId: string; stepKey: string }> }) => {
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
    if (!run) return NextResponse.json({ artifacts: [] })
    const artifacts = await prisma.artifact.findMany({
      where: { runId: run.id, stepKey },
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
    return NextResponse.json({
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
  },
)

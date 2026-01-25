import { prisma } from "@/lib/server/db"
import { notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { normalizePublicId } from "@/lib/server/public-ids"
import { requireRequestAuth } from "@/lib/server/authz"
import { getAgentRunFindFirstWhereByPublicId } from "@/lib/server/scopes/agent-runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ agentRunId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { agentRunId } = await ctx.params
  const publicId = normalizePublicId(agentRunId || "")
  const row = await prisma.agentRun.findFirst({
    where: getAgentRunFindFirstWhereByPublicId(viewerAuth, publicId),
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      type: true,
      status: true,
      workflowId: true,
      inputJson: true,
      snapshotJson: true,
      lastEventId: true,
      errorCode: true,
      errorMessage: true,
      errorMetaJson: true,
      errorAt: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!row) return notFound("AGENT_RUN_NOT_FOUND")

  return ok({
    agentRun: {
      id: row.publicId,
      publicId: row.publicId,
      publicNumber: row.publicNumber,
      type: row.type,
      status: row.status,
      workflowId: row.workflowId ?? null,
      snapshotJson: row.snapshotJson ?? "{}",
      inputJson: row.inputJson ?? "{}",
      lastEventId: typeof row.lastEventId === "number" ? row.lastEventId : null,
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
      errorMetaJson: row.errorMetaJson ?? null,
      errorAt: row.errorAt ?? null,
      startedAt: row.startedAt ?? null,
      finishedAt: row.finishedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  })
})

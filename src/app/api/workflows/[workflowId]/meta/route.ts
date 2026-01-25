import { prisma } from "@/lib/server/db"
import { notFound, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"
import { getWorkflowDraftMeta } from "@/lib/server/maia/workflow-meta"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()

  const wf = await prisma.workflow.findFirst({
    where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
    select: { id: true, publicId: true, name: true },
  })
  if (!wf) return notFound("WORKFLOW_NOT_FOUND")
  mark("db.workflow")

  const meta = await getWorkflowDraftMeta(wf.id)
  mark("db.meta")

  return ok({
    workflow: {
      id: wf.publicId,
      publicId: wf.publicId,
      name: wf.name,
      latestVersionNumber: meta.latestVersionNumber,
      hasUnpublishedChanges: meta.hasUnpublishedChanges,
    },
  })
})

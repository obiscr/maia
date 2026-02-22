import "server-only"

import { prisma } from "@/lib/server/db"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function deleteWorkflowByPublicId(params: { viewerAuth: ViewerAuthContext; workflowId: string }) {
  const workflowPublicId = String(params.workflowId || "")
    .trim()
    .toLowerCase()
  await ensureEngineRunning()
  const current = await prisma.workflow.findFirst({
    where: getWorkflowFindFirstWhereByPublicId(params.viewerAuth, workflowPublicId),
    select: { id: true },
  })
  if (!current) return { ok: false as const, code: "WORKFLOW_NOT_FOUND" as const }

  await prisma.$transaction(async (tx) => {
    await tx.jobRun.deleteMany({ where: { workflowId: current.id } })
    await tx.batch.deleteMany({ where: { workflowId: current.id } })
    await tx.schedule.deleteMany({ where: { workflowId: current.id } })
    await tx.run.deleteMany({ where: { workflowId: current.id } })
    await tx.workflow.delete({ where: { id: current.id } })
  })
  return { ok: true as const }
}

import "server-only"

import { prisma } from "@/lib/server/db"
import { getJobRunFindFirstWhereByPublicId } from "@/lib/server/scopes/jobs-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function deleteJobByPublicId(params: { viewerAuth: ViewerAuthContext; jobId: string }) {
  const jobPublicId = String(params.jobId || "")
    .trim()
    .toLowerCase()
  const existing = await prisma.jobRun.findFirst({
    where: getJobRunFindFirstWhereByPublicId(params.viewerAuth, jobPublicId),
    select: { id: true },
  })
  if (!existing) return { ok: false as const, code: "NOT_FOUND" as const }
  await prisma.jobRun.delete({ where: { id: existing.id } })
  return { ok: true as const }
}

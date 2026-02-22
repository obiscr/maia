import "server-only"

import { ensureEngineRunning } from "@/lib/server/maia/server"
import { prisma } from "@/lib/server/db"
import { getJobRunFindFirstWhereByPublicId } from "@/lib/server/scopes/jobs-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function cancelJobByPublicId(params: {
  viewerAuth: ViewerAuthContext
  jobId: string
  reason?: string | null
}) {
  const jobPublicId = String(params.jobId || "")
    .trim()
    .toLowerCase()
  const job = await prisma.jobRun.findFirst({
    where: getJobRunFindFirstWhereByPublicId(params.viewerAuth, jobPublicId),
    select: { id: true },
  })
  if (!job) return { ok: false as const, code: "NOT_FOUND" as const }

  const eng = await ensureEngineRunning()
  await eng.requestCancelJobRun({ jobRunId: job.id, reason: params.reason ?? null })
  void eng.tick()
  return { ok: true as const, jobPublicId }
}

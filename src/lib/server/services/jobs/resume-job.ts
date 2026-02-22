import "server-only"

import { JobRunStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import type { RequestAuthContext } from "@/lib/server/authz"
import { getJobRunFindFirstWhereByPublicId } from "@/lib/server/scopes/jobs-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function resumeJobByPublicId(params: {
  auth: RequestAuthContext
  viewerAuth: ViewerAuthContext
  jobId: string
}) {
  const jobPublicId = String(params.jobId || "")
    .trim()
    .toLowerCase()
  const job = await prisma.jobRun.findFirst({
    where: getJobRunFindFirstWhereByPublicId(params.viewerAuth, jobPublicId),
    select: { id: true, status: true },
  })
  if (!job) return { ok: false as const, code: "NOT_FOUND" as const }
  if (String(job.status) !== "PAUSED") return { ok: false as const, code: "JOB_NOT_PAUSED" as const }

  const now = new Date()
  const updated = await prisma.jobRun.updateMany({
    where: { id: job.id, status: JobRunStatus.PAUSED },
    data: {
      ...makeUpdateAudit(params.auth),
      status: JobRunStatus.QUEUED,
      queuedAt: now,
      nextAttemptAt: null,
      finishedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorMetaJson: null,
      lastErrorAt: null,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      startedAt: null,
      runId: null,
    },
  })
  if (updated.count !== 1) return { ok: false as const, code: "JOB_NOT_PAUSED" as const }

  const eng = await ensureEngineRunning()
  void eng.tick()
  return { ok: true as const, jobPublicId }
}

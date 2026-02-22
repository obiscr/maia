import "server-only"

import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { computeNextRunAt, type ScheduleLike } from "@/lib/server/maia/scheduler"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { allocatePublicId } from "@/lib/server/public-ids"
import { mergeUrlInputFilesIntoInputJson, parseStoredUrlFilesJson, toUrlInputFiles } from "@/lib/server/maia/url-files"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import type { RequestAuthContext } from "@/lib/server/authz"
import { getScheduleFindFirstWhereByPublicId } from "@/lib/server/scopes/schedules-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function runScheduleNowByPublicId(params: {
  auth: RequestAuthContext
  viewerAuth: ViewerAuthContext
  scheduleId: string
}) {
  const schedulePublicId = String(params.scheduleId || "")
    .trim()
    .toLowerCase()
  const now = new Date()
  const res = await prisma.$transaction(async (tx) => {
    const s = await tx.schedule.findFirst({
      where: getScheduleFindFirstWhereByPublicId(params.viewerAuth, schedulePublicId),
      select: {
        id: true,
        ownerUserId: true,
        enabled: true,
        workflowId: true,
        pinnedWorkflowVersionId: true,
        kind: true,
        cron: true,
        timezone: true,
        intervalMs: true,
        inputJson: true,
        urlFilesJson: true,
        nextRunAt: true,
        lastRunAt: true,
        createdAt: true,
      },
    })
    if (!s) return null
    const pub = await allocatePublicId(tx, "job")
    const storedUrlFiles = parseStoredUrlFilesJson(s.urlFilesJson)
    const inputToWrite = mergeUrlInputFilesIntoInputJson({
      inputJson: typeof s.inputJson === "string" ? s.inputJson : "{}",
      urlInputFiles: toUrlInputFiles(storedUrlFiles),
    })
    await tx.jobRun.create({
      data: {
        id: crypto.randomUUID(),
        publicId: pub.publicId,
        publicNumber: pub.publicNumber,
        status: "QUEUED",
        workflowId: s.workflowId,
        pinnedWorkflowVersionId: s.pinnedWorkflowVersionId,
        scheduleId: s.id,
        ownerUserId: s.ownerUserId ?? params.auth.userId,
        createdByUserId: params.auth.userId,
        updatedByUserId: params.auth.userId,
        triggeredByUserId: params.auth.userId,
        requestedByUserId: s.ownerUserId ?? params.auth.userId,
        scheduledFor: now,
        inputJson: inputToWrite,
        nextAttemptAt: null,
      },
      select: { id: true },
    })
    const nextRunAt = s.enabled
      ? computeNextRunAt(
          {
            kind: s.kind,
            cron: s.cron,
            timezone: s.timezone,
            intervalMs: s.intervalMs,
            nextRunAt: null,
            lastRunAt: now,
            createdAt: s.createdAt,
          } satisfies ScheduleLike,
          now,
        )
      : null
    await tx.schedule.update({
      where: { id: s.id },
      data: { lastRunAt: now, nextRunAt, ...makeUpdateAudit(params.auth) },
      select: { id: true },
    })
    return { jobPublicId: pub.publicId }
  })
  if (!res) return null
  const eng = await ensureEngineRunning()
  void eng.tick()
  return res
}

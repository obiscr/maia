import "server-only"

import { prisma } from "@/lib/server/db"
import { parseStoredUrlFilesJson } from "@/lib/server/maia/url-files"
import { getScheduleFindFirstWhereByPublicId } from "@/lib/server/scopes/schedules-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function getScheduleByPublicId(params: { viewerAuth: ViewerAuthContext; scheduleId: string }) {
  const schedulePublicId = String(params.scheduleId || "")
    .trim()
    .toLowerCase()
  const schedule = await prisma.schedule.findFirst({
    where: getScheduleFindFirstWhereByPublicId(params.viewerAuth, schedulePublicId),
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      enabled: true,
      workflowId: true,
      workflow: { select: { publicId: true, publicNumber: true, name: true } },
      pinnedWorkflowVersion: { select: { version: true, createdAt: true } },
      kind: true,
      cron: true,
      timezone: true,
      intervalMs: true,
      misfirePolicy: true,
      catchUpLimit: true,
      overlapPolicy: true,
      inputJson: true,
      urlFilesJson: true,
      nextRunAt: true,
      lastRunAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!schedule) return null
  const urlFiles = parseStoredUrlFilesJson(schedule.urlFilesJson)
  return {
    id: schedule.publicId,
    publicId: schedule.publicId,
    publicNumber: schedule.publicNumber,
    name: schedule.name,
    enabled: schedule.enabled,
    workflowId: schedule.workflow?.publicId ?? null,
    workflow: schedule.workflow
      ? {
          id: schedule.workflow.publicId,
          publicId: schedule.workflow.publicId,
          publicNumber: schedule.workflow.publicNumber,
          name: schedule.workflow.name,
        }
      : null,
    pinnedWorkflowVersion: schedule.pinnedWorkflowVersion
      ? {
          version: schedule.pinnedWorkflowVersion.version,
          createdAt: schedule.pinnedWorkflowVersion.createdAt,
        }
      : null,
    kind: schedule.kind,
    cron: schedule.cron,
    timezone: schedule.timezone,
    intervalMs: schedule.intervalMs,
    misfirePolicy: schedule.misfirePolicy,
    catchUpLimit: schedule.catchUpLimit,
    overlapPolicy: schedule.overlapPolicy,
    inputJson: schedule.inputJson,
    urlFiles,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  }
}

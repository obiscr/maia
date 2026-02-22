import "server-only"

import { prisma } from "@/lib/server/db"
import { getJobRunFindFirstWhereByPublicId } from "@/lib/server/scopes/jobs-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function getJobByPublicId(params: { viewerAuth: ViewerAuthContext; jobId: string }) {
  const jobPublicId = String(params.jobId || "")
    .trim()
    .toLowerCase()
  const job = await prisma.jobRun.findFirst({
    where: getJobRunFindFirstWhereByPublicId(params.viewerAuth, jobPublicId),
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      status: true,
      cancelRequestedAt: true,
      cancelRequestedReason: true,
      workflow: { select: { publicId: true, publicNumber: true, name: true } },
      pinnedWorkflowVersion: { select: { version: true, createdAt: true } },
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
      scheduledFor: true,
      inputJson: true,
      claimedBy: true,
      claimedAt: true,
      leaseExpiresAt: true,
      attemptCount: true,
      maxAttempts: true,
      nextAttemptAt: true,
      run: {
        select: {
          publicId: true,
          publicNumber: true,
          status: true,
          cancelRequestedAt: true,
          cancelRequestedReason: true,
          failureCode: true,
          failureMessage: true,
          failureMetaJson: true,
          failureAt: true,
          workflowVersionNumber: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
        },
      },
      lastErrorCode: true,
      lastErrorMessage: true,
      lastErrorMetaJson: true,
      lastErrorAt: true,
      schedule: {
        select: {
          publicId: true,
          publicNumber: true,
          name: true,
          kind: true,
          cron: true,
          timezone: true,
          intervalMs: true,
          nextRunAt: true,
          lastRunAt: true,
        },
      },
      batch: {
        select: {
          publicId: true,
          publicNumber: true,
          name: true,
          status: true,
          startedAt: true,
          finishedAt: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!job) return null

  return {
    id: job.publicId,
    publicId: job.publicId,
    publicNumber: job.publicNumber,
    status: job.status,
    cancelRequestedAt: job.cancelRequestedAt ?? null,
    cancelRequestedReason: job.cancelRequestedReason ?? null,
    workflowId: job.workflow?.publicId ?? null,
    workflow: job.workflow
      ? {
          id: job.workflow.publicId,
          publicId: job.workflow.publicId,
          publicNumber: job.workflow.publicNumber,
          name: job.workflow.name,
        }
      : null,
    pinnedWorkflowVersion: job.pinnedWorkflowVersion
      ? {
          version: job.pinnedWorkflowVersion.version,
          createdAt: job.pinnedWorkflowVersion.createdAt,
        }
      : null,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    scheduledFor: job.scheduledFor,
    inputJson: job.inputJson,
    claimedBy: job.claimedBy,
    claimedAt: job.claimedAt,
    leaseExpiresAt: job.leaseExpiresAt,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt,
    runId: job.run?.publicId ?? null,
    run: job.run
      ? {
          id: job.run.publicId,
          publicId: job.run.publicId,
          publicNumber: job.run.publicNumber,
          status: job.run.status,
          cancelRequestedAt: job.run.cancelRequestedAt ?? null,
          cancelRequestedReason: job.run.cancelRequestedReason ?? null,
          failureCode: job.run.failureCode ?? null,
          failureMessage: job.run.failureMessage ?? null,
          failureMetaJson: job.run.failureMetaJson ?? null,
          failureAt: job.run.failureAt ?? null,
          workflowVersionNumber: job.run.workflowVersionNumber ?? null,
          createdAt: job.run.createdAt,
          startedAt: job.run.startedAt,
          finishedAt: job.run.finishedAt,
        }
      : null,
    lastErrorCode: job.lastErrorCode ?? null,
    lastErrorMessage: job.lastErrorMessage ?? null,
    lastErrorMetaJson: job.lastErrorMetaJson ?? null,
    lastErrorAt: job.lastErrorAt ?? null,
    scheduleId: job.schedule?.publicId ?? null,
    schedule: job.schedule
      ? {
          id: job.schedule.publicId,
          publicId: job.schedule.publicId,
          publicNumber: job.schedule.publicNumber,
          name: job.schedule.name,
          kind: job.schedule.kind,
          cron: job.schedule.cron,
          timezone: job.schedule.timezone,
          intervalMs: job.schedule.intervalMs,
          nextRunAt: job.schedule.nextRunAt,
          lastRunAt: job.schedule.lastRunAt,
        }
      : null,
    batchId: job.batch?.publicId ?? null,
    batch: job.batch
      ? {
          id: job.batch.publicId,
          publicId: job.batch.publicId,
          publicNumber: job.batch.publicNumber,
          name: job.batch.name,
          status: job.batch.status,
          startedAt: job.batch.startedAt,
          finishedAt: job.batch.finishedAt,
        }
      : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

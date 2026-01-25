import "server-only"

import { prisma } from "@/lib/server/db"
import { appendStreamEvent } from "@/lib/server/realtime/store"
import { makeAdminListStreamTopic, makeStreamTopic, makeUserListStreamTopic } from "@/lib/shared/realtime/topics"

export type JobRunRealtimeState = {
  jobId: string
  status: string
  cancelRequestedAt?: string | null
  cancelRequestedReason?: string | null
  workflowId?: string | null
  workflowName?: string | null
  pinnedWorkflowVersionId?: string | null
  batchId?: string | null
  scheduleId?: string | null
  runId?: string | null
  attemptCount?: number | null
  maxAttempts?: number | null
  nextAttemptAt?: string | null
  scheduledFor?: string | null
  queuedAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
  lastErrorMetaJson?: string | null
  lastErrorAt?: string | null
  claimedBy?: string | null
  claimedAt?: string | null
  leaseExpiresAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export async function emitJobRunState(jobRunId: string) {
  if (!jobRunId) return
  const j = await prisma.jobRun.findUnique({
    where: { id: jobRunId },
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      status: true,
      cancelRequestedAt: true,
      cancelRequestedReason: true,
      workflowId: true,
      workflow: { select: { id: true, publicId: true, publicNumber: true, name: true } },
      pinnedWorkflowVersionId: true,
      batchId: true,
      batch: { select: { id: true, publicId: true, publicNumber: true, ownerUser: { select: { publicId: true } } } },
      scheduleId: true,
      schedule: {
        select: { id: true, publicId: true, publicNumber: true, ownerUser: { select: { publicId: true } } },
      },
      runId: true,
      run: { select: { id: true, publicId: true, publicNumber: true } },
      requestedByUser: { select: { publicId: true } },
      attemptCount: true,
      maxAttempts: true,
      nextAttemptAt: true,
      scheduledFor: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      lastErrorMetaJson: true,
      lastErrorAt: true,
      claimedBy: true,
      claimedAt: true,
      leaseExpiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!j) return

  const state: JobRunRealtimeState = {
    jobId: String(j.publicId ?? j.id),
    status: String(j.status),
    cancelRequestedAt: j.cancelRequestedAt ? j.cancelRequestedAt.toISOString() : null,
    cancelRequestedReason: j.cancelRequestedReason ? String(j.cancelRequestedReason) : null,
    workflowId: j.workflow?.publicId ? String(j.workflow.publicId) : j.workflowId ? String(j.workflowId) : null,
    workflowName: j.workflow?.name ? String(j.workflow.name) : null,
    pinnedWorkflowVersionId: j.pinnedWorkflowVersionId ? String(j.pinnedWorkflowVersionId) : null,
    batchId: j.batch?.publicId ? String(j.batch.publicId) : j.batchId ? String(j.batchId) : null,
    scheduleId: j.schedule?.publicId ? String(j.schedule.publicId) : j.scheduleId ? String(j.scheduleId) : null,
    runId: j.run?.publicId ? String(j.run.publicId) : j.runId ? String(j.runId) : null,
    attemptCount: typeof j.attemptCount === "number" ? j.attemptCount : null,
    maxAttempts: typeof j.maxAttempts === "number" ? j.maxAttempts : null,
    nextAttemptAt: j.nextAttemptAt ? j.nextAttemptAt.toISOString() : null,
    scheduledFor: j.scheduledFor ? j.scheduledFor.toISOString() : null,
    queuedAt: j.queuedAt ? j.queuedAt.toISOString() : null,
    startedAt: j.startedAt ? j.startedAt.toISOString() : null,
    finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
    lastErrorCode: j.lastErrorCode ? String(j.lastErrorCode) : null,
    lastErrorMessage: j.lastErrorMessage ? String(j.lastErrorMessage) : null,
    lastErrorMetaJson: j.lastErrorMetaJson ? String(j.lastErrorMetaJson) : null,
    lastErrorAt: j.lastErrorAt ? j.lastErrorAt.toISOString() : null,
    claimedBy: j.claimedBy ? String(j.claimedBy) : null,
    claimedAt: j.claimedAt ? j.claimedAt.toISOString() : null,
    leaseExpiresAt: j.leaseExpiresAt ? j.leaseExpiresAt.toISOString() : null,
    createdAt: j.createdAt ? j.createdAt.toISOString() : null,
    updatedAt: j.updatedAt ? j.updatedAt.toISOString() : null,
  }

  // Collection topic(s) for list pages.
  await appendStreamEvent({ topic: makeAdminListStreamTopic("jobs"), event: "job_state", data: state })
  const requestedByPublicId = j.requestedByUser?.publicId ? String(j.requestedByUser.publicId) : ""
  if (requestedByPublicId) {
    await appendStreamEvent({
      topic: makeUserListStreamTopic("jobs", requestedByPublicId),
      event: "job_state",
      data: state,
    })
  }
  await appendStreamEvent({ topic: makeStreamTopic("job", state.jobId), event: "job_state", data: state })

  if (state.batchId) {
    await appendStreamEvent({
      topic: makeStreamTopic("batch", state.batchId),
      event: "job_state",
      data: state,
    })

    // Also mark the Batches list as dirty (list UI listens for job_state).
    await appendStreamEvent({ topic: makeAdminListStreamTopic("batches"), event: "job_state", data: state })
    const batchOwnerPublicId = j.batch?.ownerUser?.publicId ? String(j.batch.ownerUser.publicId) : ""
    if (batchOwnerPublicId) {
      await appendStreamEvent({
        topic: makeUserListStreamTopic("batches", batchOwnerPublicId),
        event: "job_state",
        data: state,
      })
    }
  }
  if (state.scheduleId) {
    await appendStreamEvent({
      topic: makeAdminListStreamTopic("schedules"),
      event: "job_state",
      data: state,
    })
    const scheduleOwnerPublicId = j.schedule?.ownerUser?.publicId ? String(j.schedule.ownerUser.publicId) : ""
    if (scheduleOwnerPublicId) {
      await appendStreamEvent({
        topic: makeUserListStreamTopic("schedules", scheduleOwnerPublicId),
        event: "job_state",
        data: state,
      })
    }
    await appendStreamEvent({
      topic: makeStreamTopic("schedule", state.scheduleId),
      event: "job_state",
      data: state,
    })
  }
}

export type BatchRealtimeState = {
  batchId: string
  status: string
  startedAt?: string | null
  finishedAt?: string | null
  jobsTotal?: number | null
  jobsByStatus?: Record<string, number> | null
}

export async function emitBatchState(params: BatchRealtimeState) {
  if (!params.batchId) return
  // Emit to admin list, and to the owning user's list if we can resolve it.
  await appendStreamEvent({ topic: makeAdminListStreamTopic("batches"), event: "batch_state", data: params })
  const batchPublicId = String(params.batchId)
  const ownerPublicId =
    (await prisma.batch
      .findFirst({
        where: { OR: [{ publicId: batchPublicId }, { id: batchPublicId }] },
        select: { ownerUser: { select: { publicId: true } } },
      })
      .then((r) => (r?.ownerUser?.publicId ? String(r.ownerUser.publicId) : ""))
      .catch(() => "")) || ""
  if (ownerPublicId) {
    await appendStreamEvent({
      topic: makeUserListStreamTopic("batches", ownerPublicId),
      event: "batch_state",
      data: params,
    })
  }
  await appendStreamEvent({
    topic: makeStreamTopic("batch", params.batchId),
    event: "batch_state",
    data: params,
  })
}

export type ScheduleRealtimeState = {
  scheduleId: string
  enabled: boolean
  kind: string
  cron?: string | null
  timezone?: string | null
  intervalMs?: number | null
  misfirePolicy?: string | null
  catchUpLimit?: number | null
  overlapPolicy?: string | null
  nextRunAt?: string | null
  lastRunAt?: string | null
  updatedAt?: string | null
  workflowId?: string | null
  workflowName?: string | null
}

export async function emitScheduleState(scheduleId: string) {
  if (!scheduleId) return
  const s = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      enabled: true,
      ownerUser: { select: { publicId: true } },
      workflowId: true,
      workflow: { select: { id: true, publicId: true, publicNumber: true, name: true } },
      kind: true,
      cron: true,
      timezone: true,
      intervalMs: true,
      misfirePolicy: true,
      catchUpLimit: true,
      overlapPolicy: true,
      nextRunAt: true,
      lastRunAt: true,
      updatedAt: true,
    },
  })
  if (!s) return
  const state: ScheduleRealtimeState = {
    scheduleId: String(s.publicId ?? s.id),
    enabled: Boolean(s.enabled),
    kind: String(s.kind),
    cron: s.cron ? String(s.cron) : null,
    timezone: s.timezone ? String(s.timezone) : null,
    intervalMs: typeof s.intervalMs === "number" ? s.intervalMs : null,
    misfirePolicy: s.misfirePolicy ? String(s.misfirePolicy) : null,
    catchUpLimit: typeof s.catchUpLimit === "number" ? s.catchUpLimit : null,
    overlapPolicy: s.overlapPolicy ? String(s.overlapPolicy) : null,
    nextRunAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
    workflowId: s.workflow?.publicId ? String(s.workflow.publicId) : s.workflowId ? String(s.workflowId) : null,
    workflowName: s.workflow?.name ? String(s.workflow.name) : null,
  }
  await appendStreamEvent({ topic: makeAdminListStreamTopic("schedules"), event: "schedule_state", data: state })
  const ownerPublicId = s.ownerUser?.publicId ? String(s.ownerUser.publicId) : ""
  if (ownerPublicId) {
    await appendStreamEvent({
      topic: makeUserListStreamTopic("schedules", ownerPublicId),
      event: "schedule_state",
      data: state,
    })
  }
  await appendStreamEvent({
    topic: makeStreamTopic("schedule", state.scheduleId),
    event: "schedule_state",
    data: state,
  })
}

export async function emitScheduleDeleted(params: { scheduleId: string; ownerUserPublicId?: string | null }) {
  const schedulePublicId = String(params.scheduleId || "")
  if (!schedulePublicId) return
  const payload = { scheduleId: schedulePublicId }
  await appendStreamEvent({ topic: makeAdminListStreamTopic("schedules"), event: "schedule_deleted", data: payload })
  const ownerPublicId = params.ownerUserPublicId ? String(params.ownerUserPublicId) : ""
  if (ownerPublicId) {
    await appendStreamEvent({
      topic: makeUserListStreamTopic("schedules", ownerPublicId),
      event: "schedule_deleted",
      data: payload,
    })
  }
  await appendStreamEvent({
    topic: makeStreamTopic("schedule", schedulePublicId),
    event: "schedule_deleted",
    data: payload,
  })
}

export type WorkflowDepsLogEvent = { workflowId: string; level: string; message: string }
export type WorkflowDepsStatusEvent = {
  workflowId: string
  depsStatus: string
  depsErrorCode?: string | null
  depsErrorMessage?: string | null
}

export async function emitWorkflowDepsLog(params: WorkflowDepsLogEvent) {
  if (!params.workflowId) return
  await appendStreamEvent({
    topic: makeStreamTopic("workflowDeps", String(params.workflowId)),
    event: "deps_log",
    data: {
      workflowId: String(params.workflowId),
      level: String(params.level || "INFO"),
      message: String(params.message || ""),
    },
  })
}

export async function emitWorkflowDepsStatus(params: WorkflowDepsStatusEvent) {
  if (!params.workflowId) return
  await appendStreamEvent({
    topic: makeStreamTopic("workflowDeps", String(params.workflowId)),
    event: "deps_status",
    data: {
      workflowId: String(params.workflowId),
      depsStatus: String(params.depsStatus || ""),
      depsErrorCode: params.depsErrorCode ?? null,
      depsErrorMessage: params.depsErrorMessage ?? null,
    },
  })
}

import "server-only"

import { LogLevel, LogSource } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { appendStreamEvent } from "@/lib/server/realtime/store"
import { makeAdminListStreamTopic, makeStreamTopic, makeUserListStreamTopic } from "@/lib/shared/realtime/topics"
export type { RunStepErrorCode, RunStepErrorMeta } from "@/lib/shared/run-errors"
import type { RunStepErrorCode, RunStepErrorMeta } from "@/lib/shared/run-errors"

type EventMeta = { ts?: string; level?: string; source?: string }

const runPublicIdCache = new Map<string, string>()
const runTriggeredByPublicIdCache = new Map<string, string>()

async function resolveRunPublicId(runInternalId: string) {
  const k = String(runInternalId || "")
  if (!k) return k
  const cached = runPublicIdCache.get(k)
  if (cached) return cached
  const r = await prisma.run.findUnique({
    where: { id: k },
    select: { publicId: true, triggeredByUser: { select: { publicId: true } } },
  })
  const pub = r?.publicId ? String(r.publicId) : k
  runPublicIdCache.set(k, pub)
  const trig = r?.triggeredByUser?.publicId ? String(r.triggeredByUser.publicId) : ""
  if (trig) runTriggeredByPublicIdCache.set(k, trig)
  return pub
}

async function resolveRunTriggeredByPublicId(runInternalId: string) {
  const k = String(runInternalId || "")
  if (!k) return ""
  const cached = runTriggeredByPublicIdCache.get(k)
  if (cached) return cached
  const r = await prisma.run.findUnique({
    where: { id: k },
    select: { triggeredByUser: { select: { publicId: true } } },
  })
  const trig = r?.triggeredByUser?.publicId ? String(r.triggeredByUser.publicId) : ""
  if (trig) runTriggeredByPublicIdCache.set(k, trig)
  return trig
}

export type RunStreamEvent =
  | ({ type: "run_status"; runId: string; status: string } & EventMeta)
  | ({
      type: "run_cancel_requested"
      runId: string
      cancelRequestedAt: string
      reason?: string | null
    } & EventMeta)
  | ({ type: "run_force_stop_requested"; runId: string } & EventMeta)
  | ({ type: "step_status"; runId: string; stepKey: string; status: string; attemptNo?: number } & EventMeta)
  | ({
      type: "input_file_status"
      runId: string
      fileId: string
      status: string
      path?: string | null
      error?: string | null
      sizeBytes?: number | null
      sha256?: string | null
      mime?: string | null
    } & EventMeta)
  | ({
      type: "step_error"
      runId: string
      stepKey: string
      attemptNo: number
      code: RunStepErrorCode
      meta?: RunStepErrorMeta
    } & EventMeta)
  | {
      type: "log_line"
      runId: string
      stepKey: string
      attemptNo: number
      stream: "stdout" | "stderr"
      line: string
      kind?: "log" | "status"
      // Enriched by the streaming endpoint from DB metadata.
      ts?: string
      level?: string
      source?: string
    }
  | ({
      type: "artifact_created"
      runId: string
      stepKey: string
      attemptNo: number
      kind: string
      path: string
    } & EventMeta)
  | ({ type: "system"; runId: string; message: string } & EventMeta)

export async function createLogEvent(params: {
  runId?: string | null
  stepKey?: string | null
  attemptNo?: number | null
  level?: LogLevel
  source?: LogSource
  message: string
}) {
  const row = await prisma.logEvent.create({
    data: {
      runId: params.runId ?? null,
      stepKey: params.stepKey ?? null,
      attemptNo: params.attemptNo ?? null,
      level: params.level ?? LogLevel.INFO,
      source: params.source ?? LogSource.SYSTEM,
      message: params.message,
    },
  })
  return row
}

export async function emitRunStatus(runId: string, status: string) {
  const runPublicId = await resolveRunPublicId(runId)
  const triggeredByPublicId = await resolveRunTriggeredByPublicId(runId)
  const payload: RunStreamEvent = { type: "run_status", runId: runPublicId, status }
  const row = await createLogEvent({
    runId,
    level: LogLevel.INFO,
    source: LogSource.SYSTEM,
    message: JSON.stringify(payload),
  })
  const enriched: RunStreamEvent = {
    ...payload,
    ts: row.createdAt.toISOString(),
    level: String(row.level),
    source: String(row.source),
  }
  await appendStreamEvent({ topic: makeStreamTopic("run", runPublicId), event: "run_status", data: enriched }).catch(
    () => {},
  )
  await appendStreamEvent({ topic: makeAdminListStreamTopic("runs"), event: "run_status", data: payload }).catch(
    () => {},
  )
  if (triggeredByPublicId) {
    await appendStreamEvent({
      topic: makeUserListStreamTopic("runs", triggeredByPublicId),
      event: "run_status",
      data: payload,
    }).catch(() => {})
  }
  return row
}

export async function emitRunCancelRequested(params: {
  runId: string
  cancelRequestedAt: string
  reason?: string | null
}) {
  const runPublicId = await resolveRunPublicId(params.runId)
  const triggeredByPublicId = await resolveRunTriggeredByPublicId(params.runId)
  const payload: RunStreamEvent = {
    type: "run_cancel_requested",
    runId: runPublicId,
    cancelRequestedAt: params.cancelRequestedAt,
    reason: params.reason ?? null,
  }
  const row = await createLogEvent({
    runId: params.runId,
    level: LogLevel.INFO,
    source: LogSource.SYSTEM,
    message: JSON.stringify(payload),
  })
  const enriched: RunStreamEvent = {
    ...payload,
    ts: row.createdAt.toISOString(),
    level: String(row.level),
    source: String(row.source),
  }
  // Per-run topic (optional; some UIs may display these later).
  await appendStreamEvent({
    topic: makeStreamTopic("run", runPublicId),
    event: "run_cancel_requested",
    data: enriched,
  }).catch(() => {})
  // List topic: used to trigger lightweight refresh (shows CANCELING state without manual refresh).
  await appendStreamEvent({
    topic: makeAdminListStreamTopic("runs"),
    event: "run_cancel_requested",
    data: enriched,
  }).catch(() => {})
  if (triggeredByPublicId) {
    await appendStreamEvent({
      topic: makeUserListStreamTopic("runs", triggeredByPublicId),
      event: "run_cancel_requested",
      data: enriched,
    }).catch(() => {})
  }
  return row
}

export async function emitRunForceStopRequested(runId: string) {
  const runPublicId = await resolveRunPublicId(runId)
  const triggeredByPublicId = await resolveRunTriggeredByPublicId(runId)
  const payload: RunStreamEvent = { type: "run_force_stop_requested", runId: runPublicId }
  const row = await createLogEvent({
    runId,
    level: LogLevel.INFO,
    source: LogSource.SYSTEM,
    message: JSON.stringify(payload),
  })
  const enriched: RunStreamEvent = {
    ...payload,
    ts: row.createdAt.toISOString(),
    level: String(row.level),
    source: String(row.source),
  }
  await appendStreamEvent({
    topic: makeStreamTopic("run", runPublicId),
    event: "run_force_stop_requested",
    data: enriched,
  }).catch(() => {})
  await appendStreamEvent({
    topic: makeAdminListStreamTopic("runs"),
    event: "run_force_stop_requested",
    data: enriched,
  }).catch(() => {})
  if (triggeredByPublicId) {
    await appendStreamEvent({
      topic: makeUserListStreamTopic("runs", triggeredByPublicId),
      event: "run_force_stop_requested",
      data: enriched,
    }).catch(() => {})
  }
  return row
}

export async function emitStepStatus(runId: string, stepKey: string, status: string, attemptNo?: number) {
  const runPublicId = await resolveRunPublicId(runId)
  const payload: RunStreamEvent = { type: "step_status", runId: runPublicId, stepKey, status, attemptNo }
  const row = await createLogEvent({
    runId,
    stepKey,
    attemptNo: attemptNo ?? null,
    level: LogLevel.INFO,
    source: LogSource.SYSTEM,
    message: JSON.stringify(payload),
  })
  const enriched: RunStreamEvent = {
    ...payload,
    ts: row.createdAt.toISOString(),
    level: String(row.level),
    source: String(row.source),
  }
  await appendStreamEvent({ topic: makeStreamTopic("run", runPublicId), event: "step_status", data: enriched }).catch(
    () => {},
  )
  return row
}

export async function emitSystem(runId: string, message: string, level: LogLevel = LogLevel.INFO) {
  const runPublicId = await resolveRunPublicId(runId)
  const payload: RunStreamEvent = { type: "system", runId: runPublicId, message }
  const row = await createLogEvent({ runId, level, source: LogSource.SYSTEM, message: JSON.stringify(payload) })
  const enriched: RunStreamEvent = {
    ...payload,
    ts: row.createdAt.toISOString(),
    level: String(row.level),
    source: String(row.source),
  }
  await appendStreamEvent({ topic: makeStreamTopic("run", runPublicId), event: "system", data: enriched }).catch(
    () => {},
  )
  return row
}

export async function emitStepError(params: {
  runId: string
  stepKey: string
  attemptNo: number
  code: RunStepErrorCode
  meta?: RunStepErrorMeta
  level?: LogLevel
}) {
  const runPublicId = await resolveRunPublicId(params.runId)
  const payload: RunStreamEvent = {
    type: "step_error",
    runId: runPublicId,
    stepKey: params.stepKey,
    attemptNo: params.attemptNo,
    code: params.code,
    meta: params.meta ?? {},
  }
  const row = await createLogEvent({
    runId: params.runId,
    stepKey: params.stepKey,
    attemptNo: params.attemptNo,
    level: params.level ?? LogLevel.ERROR,
    source: LogSource.SYSTEM,
    message: JSON.stringify(payload),
  })
  const enriched: RunStreamEvent = {
    ...payload,
    ts: row.createdAt.toISOString(),
    level: String(row.level),
    source: String(row.source),
  }
  await appendStreamEvent({ topic: makeStreamTopic("run", runPublicId), event: "step_error", data: enriched }).catch(
    () => {},
  )
  return row
}

export async function emitInputFileStatus(params: {
  runId: string
  fileId: string
  status: string
  path?: string | null
  error?: string | null
  sizeBytes?: number | null
  sha256?: string | null
  mime?: string | null
}) {
  const runPublicId = await resolveRunPublicId(params.runId)
  const payload: RunStreamEvent = {
    type: "input_file_status",
    runId: runPublicId,
    fileId: params.fileId,
    status: params.status,
    path: params.path ?? null,
    error: params.error ?? null,
    sizeBytes: typeof params.sizeBytes === "number" ? params.sizeBytes : null,
    sha256: params.sha256 ?? null,
    mime: params.mime ?? null,
  }
  const level = String(params.status).toLowerCase() === "failed" ? LogLevel.ERROR : LogLevel.INFO
  const row = await createLogEvent({
    runId: params.runId,
    level,
    source: LogSource.SYSTEM,
    message: JSON.stringify(payload),
  })
  const enriched: RunStreamEvent = {
    ...payload,
    ts: row.createdAt.toISOString(),
    level: String(row.level),
    source: String(row.source),
  }
  await appendStreamEvent({
    topic: makeStreamTopic("run", runPublicId),
    event: "input_file_status",
    data: enriched,
  }).catch(() => {})
  return row
}

export async function emitLogLineWithMeta(params: {
  runId: string
  stepKey: string
  attemptNo: number
  stream: "stdout" | "stderr"
  line: string
  level?: LogLevel
  source?: LogSource
  kind?: "log" | "status"
}) {
  const runPublicId = await resolveRunPublicId(params.runId)
  const payload: RunStreamEvent = {
    type: "log_line",
    runId: runPublicId,
    stepKey: params.stepKey,
    attemptNo: params.attemptNo,
    stream: params.stream,
    line: params.line,
    kind: params.kind,
  }
  const row = await createLogEvent({
    runId: params.runId,
    stepKey: params.stepKey,
    attemptNo: params.attemptNo,
    level: params.level ?? (params.stream === "stderr" ? LogLevel.WARN : LogLevel.INFO),
    source: params.source ?? (params.stream === "stderr" ? LogSource.STDERR : LogSource.STDOUT),
    message: JSON.stringify(payload),
  })
  const enriched: RunStreamEvent = {
    ...payload,
    ts: row.createdAt.toISOString(),
    level: String(row.level),
    source: String(row.source),
  }
  await appendStreamEvent({ topic: makeStreamTopic("run", runPublicId), event: "log_line", data: enriched }).catch(
    () => {},
  )
  return row
}

export async function emitLogLine(params: {
  runId: string
  stepKey: string
  attemptNo: number
  stream: "stdout" | "stderr"
  line: string
}) {
  return await emitLogLineWithMeta(params)
}

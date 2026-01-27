import "server-only"

import fs from "fs/promises"
import path from "path"
import crypto from "crypto"

import type { Prisma } from "@prisma/client"
import { LogLevel, LogSource, RunStatus, StepStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import {
  emitLogLineWithMeta,
  emitRunCancelRequested,
  emitRunForceStopRequested,
  emitRunStatus,
  emitStepStatus,
  emitSystem,
} from "@/lib/server/maia/logging"
import { runDir } from "@/lib/server/maia/paths"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { emitJobRunState } from "@/lib/server/maia/realtime"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { allocatePublicId } from "@/lib/server/public-ids"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

function rewriteRunIdInJsonMessage(message: string, newRunId: string): string {
  if (!message) return message
  try {
    const parsed: unknown = JSON.parse(message)
    if (!parsed || typeof parsed !== "object") return message
    if (!("runId" in parsed)) return message
    const obj = parsed as Record<string, unknown>
    if (typeof obj.runId === "string") obj.runId = newRunId
    return JSON.stringify(obj)
  } catch {
    return message
  }
}

async function rebuildRunTopicStreamEventsFromLogEvents(runId: string) {
  const runRow = await prisma.run.findUnique({ where: { id: runId }, select: { publicId: true } })
  const runPublicId = runRow?.publicId ? String(runRow.publicId) : runId
  const topic = makeStreamTopic("run", runPublicId)

  // Replace the per-run stream topic based on persisted LogEvent history.
  await prisma.streamEvent.deleteMany({ where: { topic } })

  const logs = await prisma.logEvent.findMany({
    where: { runId },
    orderBy: [{ id: "asc" }],
    select: { message: true, createdAt: true },
  })

  const rows: Prisma.StreamEventCreateManyInput[] = []
  for (const l of logs) {
    let dataRaw: unknown = null
    try {
      dataRaw = JSON.parse(String(l.message ?? "null"))
    } catch {
      dataRaw = null
    }

    const data: Record<string, unknown> =
      isPlainObject(dataRaw) && typeof dataRaw.type === "string"
        ? { ...(dataRaw as Record<string, unknown>) }
        : { type: "system", runId, message: String(l.message ?? "") }

    // Ensure runId is consistent with the topic runId.
    if (typeof data.runId === "string") data.runId = runPublicId

    rows.push({
      topic,
      event: String(data.type),
      dataJson: JSON.stringify(data),
      createdAt: l.createdAt,
    })
  }

  // Batch inserts to avoid SQLite/Prisma parameter limits on very chatty runs.
  const batchSize = 500
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    await prisma.streamEvent.createMany({ data: batch })
  }
}

export async function cancelRun(params: {
  runId: string
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  await params.finishRun(params.runId, RunStatus.CANCELED)
}

export async function requestCancelRun(params: {
  runId: string
  reason?: string | null
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  const runId = params.runId
  const reason = typeof params.reason === "string" && params.reason.trim() ? params.reason.trim() : null
  const now = new Date()

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true, status: true, cancelRequestedAt: true },
  })
  if (!run) return { ok: false as const, code: "NOT_FOUND" as const }

  const terminal = new Set<RunStatus>([RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELED])
  if (terminal.has(run.status)) return { ok: true as const, alreadyTerminal: true as const }
  if (run.cancelRequestedAt) return { ok: true as const, alreadyRequested: true as const }

  try {
    await prisma.run.update({
      where: { id: runId },
      data: { cancelRequestedAt: now, cancelRequestedReason: reason },
    })
  } catch (e) {
    // Back-compat: if the local DB hasn't been migrated yet, don't break cancel.
    // In that case, fall back to immediate cancellation (no "cancelRequestedAt" persisted).
    const msg = e instanceof Error ? e.message : String(e)
    const looksLikeMissingColumn =
      msg.includes("cancelRequestedAt") ||
      msg.includes("cancelRequestedReason") ||
      msg.includes("no such column") ||
      msg.includes("Unknown column")
    if (!looksLikeMissingColumn) throw e
    await emitSystem(
      runId,
      "cancel requested (legacy db schema; apply migrations for canceling state)",
      LogLevel.INFO,
    ).catch(() => {})
    await params.finishRun(runId, RunStatus.CANCELED)
    return { ok: true as const, legacyDb: true as const }
  }

  const linkedJob = await prisma.jobRun.findFirst({
    where: { runId },
    select: { id: true, cancelRequestedAt: true },
  })
  if (linkedJob && !linkedJob.cancelRequestedAt) {
    await prisma.jobRun
      .updateMany({
        where: { id: linkedJob.id, cancelRequestedAt: null },
        data: { cancelRequestedAt: now, cancelRequestedReason: reason },
      })
      .catch(() => {})
    await emitJobRunState(linkedJob.id).catch(() => {})
  }

  await emitRunCancelRequested({ runId, cancelRequestedAt: now.toISOString(), reason }).catch(() => {})

  // Make the cancellation visible immediately in the step log view (which does not render run-level "system" events).
  // We emit an actual log line (kind="log") so it won't be filtered out.
  const msg = reason ? `cancel requested: ${reason}` : "cancel requested"
  const runningSteps = await prisma.runStep.findMany({
    where: { runId, status: StepStatus.RUNNING },
    select: { stepKey: true },
  })
  const stepKeys =
    runningSteps.length > 0
      ? runningSteps.map((s) => String(s.stepKey))
      : (
          await prisma.runStep.findMany({
            where: { runId },
            orderBy: [{ createdAt: "asc" }],
            take: 1,
            select: { stepKey: true },
          })
        ).map((s) => String(s.stepKey))

  for (const stepKey of stepKeys) {
    await emitLogLineWithMeta({
      runId,
      stepKey,
      attemptNo: 0,
      stream: "stdout",
      line: msg,
      level: LogLevel.INFO,
      source: LogSource.SYSTEM,
    }).catch(() => {})
  }
  await emitSystem(runId, msg, LogLevel.INFO).catch(() => {})

  return { ok: true as const }
}

export async function forceStopRun(params: {
  runId: string
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  const runId = params.runId
  const now = new Date()
  try {
    await prisma.run.updateMany({
      where: { id: runId, cancelRequestedAt: null },
      data: { cancelRequestedAt: now, cancelRequestedReason: "force-stop" },
    })
  } catch {
    // ignore (legacy schema / etc)
  }

  // Make it visible in the step log view.
  const stepKeys = (
    await prisma.runStep.findMany({
      where: { runId },
      orderBy: [{ createdAt: "asc" }],
      select: { stepKey: true },
    })
  ).map((s) => String(s.stepKey))

  for (const stepKey of stepKeys.slice(0, 3)) {
    await emitLogLineWithMeta({
      runId,
      stepKey,
      attemptNo: 0,
      stream: "stdout",
      line: "force stop requested",
      level: LogLevel.INFO,
      source: LogSource.SYSTEM,
    }).catch(() => {})
  }
  await emitSystem(runId, "force stop requested", LogLevel.INFO).catch(() => {})
  await emitRunForceStopRequested(runId).catch(() => {})

  await params.finishRun(runId, RunStatus.CANCELED)
}

async function forkRun(params: {
  sourceRunId: string
  now: Date
  forkKind: "rerun_step" | "restart_from_step"
  forkStepKey: string
}): Promise<{ newRunId: string; source: { workflowSnap: string } }> {
  const { sourceRunId, now, forkKind, forkStepKey } = params
  const src = await prisma.run.findUnique({ where: { id: sourceRunId } })
  if (!src) throw new Error("Run not found")

  const newRunId = crypto.randomUUID()
  const pub = await allocatePublicId(prisma, "run")

  // Create the new Run first (so FK relations can reference it).
  await prisma.run.create({
    data: {
      id: newRunId,
      publicId: pub.publicId,
      publicNumber: pub.publicNumber,
      workflowId: src.workflowId,
      workflowVersionId: src.workflowVersionId ?? null,
      workflowVersionNumber: src.workflowVersionNumber ?? null,
      workflowName: src.workflowName,
      workflowSnap: src.workflowSnap,
      status: RunStatus.RUNNING,
      cancelRequestedAt: null,
      cancelRequestedReason: null,
      forkedFromRunId: src.publicId ?? sourceRunId,
      forkKind,
      forkStepKey,
      failureCode: null,
      failureMessage: null,
      failureMetaJson: null,
      failureAt: null,
      initialInput: src.initialInput,
      ownerUserId: src.ownerUserId ?? src.triggeredByUserId ?? null,
      createdByUserId: src.createdByUserId ?? src.triggeredByUserId ?? null,
      updatedByUserId: src.updatedByUserId ?? src.createdByUserId ?? src.triggeredByUserId ?? null,
      triggeredByUserId: src.triggeredByUserId ?? null,
      triggerKind: src.triggerKind ?? "fork",
      startedAt: now,
      finishedAt: null,
    },
  })

  // Clone DB state (steps/attempts/artifacts/logs) so upstream results remain usable.
  const steps = await prisma.runStep.findMany({ where: { runId: sourceRunId } })
  if (steps.length) {
    const data: Prisma.RunStepCreateManyInput[] = steps.map((s) => ({
      id: crypto.randomUUID(),
      runId: newRunId,
      stepKey: s.stepKey,
      name: s.name,
      status: s.status,
      depsJson: s.depsJson,
      scriptEsm: s.scriptEsm,
      timeoutMs: s.timeoutMs,
      retryPolicyJson: (s as any).retryPolicyJson ?? "{}",
      nextAttemptAt: (s as any).nextAttemptAt ?? null,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
    await prisma.runStep.createMany({
      data,
    })
  }

  const attempts = await prisma.attempt.findMany({ where: { runId: sourceRunId } })
  if (attempts.length) {
    const data: Prisma.AttemptCreateManyInput[] = attempts.map((a) => ({
      id: crypto.randomUUID(),
      runId: newRunId,
      stepKey: a.stepKey,
      attemptNo: a.attemptNo,
      status: a.status,
      workerId: (a as any).workerId ?? null,
      leaseExpiresAt: (a as any).leaseExpiresAt ?? null,
      heartbeatAt: (a as any).heartbeatAt ?? null,
      deadlineAt: (a as any).deadlineAt ?? null,
      exitCode: a.exitCode,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      errorMetaJson: a.errorMetaJson,
      errorAt: a.errorAt,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }))
    await prisma.attempt.createMany({
      data,
    })
  }

  const artifacts = await prisma.artifact.findMany({ where: { runId: sourceRunId } })
  if (artifacts.length) {
    const data: Prisma.ArtifactCreateManyInput[] = artifacts.map((a) => ({
      id: crypto.randomUUID(),
      runId: newRunId,
      stepKey: a.stepKey,
      attemptNo: a.attemptNo,
      kind: a.kind,
      path: a.path,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
      summary: a.summary,
      createdAt: a.createdAt,
    }))
    await prisma.artifact.createMany({
      data,
    })
  }

  const logs = await prisma.logEvent.findMany({ where: { runId: sourceRunId }, orderBy: [{ id: "asc" }] })
  if (logs.length) {
    const data: Prisma.LogEventCreateManyInput[] = logs.map((l) => ({
      runId: newRunId,
      stepKey: l.stepKey,
      attemptNo: l.attemptNo,
      level: l.level,
      source: l.source,
      // Ensure the message payload's runId matches the forked run (some UIs/analytics rely on it).
      message: rewriteRunIdInJsonMessage(String(l.message ?? ""), newRunId),
      createdAt: l.createdAt,
    }))
    await prisma.logEvent.createMany({
      data,
    })
  }

  // Clone filesystem state (so step IO/artifacts exist under new run dir).
  // Note: if src dir doesn't exist (older data), this is best-effort.
  const srcDir = runDir(sourceRunId)
  const dstDir = runDir(newRunId)
  await fs.mkdir(dstDir, { recursive: true }).catch(() => {})
  await fs.cp(srcDir, dstDir, { recursive: true, force: true }).catch(() => {})

  return { newRunId, source: { workflowSnap: src.workflowSnap } }
}

async function resetStepInFork(params: {
  runId: string
  stepKeys: string[]
  now: Date
  kind: "restart_from_step" | "rerun_step"
}) {
  const { runId, stepKeys, now } = params

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const runRow = await tx.run.findUnique({ where: { id: runId }, select: { publicId: true } })
    const runPublicId = runRow?.publicId ? String(runRow.publicId) : runId
    await tx.artifact.deleteMany({ where: { runId, stepKey: { in: stepKeys } } })
    await tx.attempt.deleteMany({ where: { runId, stepKey: { in: stepKeys } } })
    await tx.logEvent.deleteMany({ where: { runId, stepKey: { in: stepKeys } } })
    // Remove run-level system logs from the source run (cancel, previous terminal status, etc).
    // Forked runs should read as a new execution session.
    await tx.logEvent.deleteMany({ where: { runId, stepKey: null } })
    // Forked runs clone LogEvent history, but the run detail UI consumes StreamEvent (SSE replay).
    // We'll rebuild the per-run StreamEvent topic from LogEvent after the reset completes.
    await tx.streamEvent.deleteMany({ where: { topic: makeStreamTopic("run", runPublicId) } })
    await tx.runStep.updateMany({
      where: { runId, stepKey: { in: stepKeys } },
      data: { status: StepStatus.PENDING, startedAt: null, finishedAt: null },
    })
    await tx.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.RUNNING,
        startedAt: now,
        finishedAt: null,
        failureCode: null,
        failureMessage: null,
        failureMetaJson: null,
        failureAt: null,
      },
    })
  })

  await rebuildRunTopicStreamEventsFromLogEvents(runId).catch(() => {})

  // Clear filesystem dirs for affected steps in the forked run.
  for (const stepKey of stepKeys) {
    const dir = path.join(runDir(runId), "steps", stepKey)
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  // Emit status events so graph/UIs update immediately.
  await emitRunStatus(runId, RunStatus.RUNNING).catch(() => {})
  for (const stepKey of stepKeys) {
    await emitStepStatus(runId, stepKey, StepStatus.PENDING).catch(() => {})
  }
  if (params.kind === "rerun_step") {
    await emitSystem(runId, `rerun_step requested (forked run): ${stepKeys[0]}`).catch(() => {})
  } else {
    await emitSystem(runId, `restart_from_step requested (forked run): ${stepKeys[0]}`).catch(() => {})
  }
}

export async function retryStep(params: { runId: string; stepKey: string }) {
  const { runId, stepKey } = params
  // Important: do NOT mutate the run row if there is nothing to retry,
  // otherwise clicking "retry" on a SUCCEEDED step would incorrectly reset the run to PENDING.
  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const stepUpd = await tx.runStep.updateMany({
      where: { runId, stepKey, status: StepStatus.FAILED },
      data: { status: StepStatus.PENDING, finishedAt: null },
    })
    if (stepUpd.count === 0) return false
    await tx.run.update({
      where: { id: runId },
      data: { status: RunStatus.RUNNING, startedAt: new Date(), finishedAt: null },
    })
    return true
  })

  if (!updated) {
    await emitSystem(runId, `retry ignored (step not FAILED): ${stepKey}`)
    return
  }

  // Emit status events so UIs update immediately without requiring a refresh.
  await emitRunStatus(runId, RunStatus.RUNNING)
  await emitStepStatus(runId, stepKey, StepStatus.PENDING)
  await emitSystem(runId, `retry requested: ${stepKey}`)
}

export async function rerunStep(params: { runId: string; stepKey: string }): Promise<{ ok: true; newRunId: string }> {
  const { runId, stepKey } = params
  const now = new Date()

  const step = await prisma.runStep.findUnique({
    where: { runId_stepKey: { runId, stepKey } },
    select: { status: true },
  })
  if (!step) throw new Error("RunStep not found")
  const terminal = new Set<StepStatus>([
    StepStatus.SUCCEEDED,
    StepStatus.FAILED,
    StepStatus.CANCELED,
    StepStatus.SKIPPED,
  ])
  if (!terminal.has(step.status)) {
    await emitSystem(runId, `rerun_step ignored (step not terminal): ${stepKey}`).catch(() => {})
    return { ok: true, newRunId: runId }
  }

  const forked = await forkRun({ sourceRunId: runId, now, forkKind: "rerun_step", forkStepKey: stepKey })
  await resetStepInFork({ runId: forked.newRunId, stepKeys: [stepKey], now, kind: "rerun_step" })
  return { ok: true, newRunId: forked.newRunId }
}

export async function restartFromStep(params: { runId: string; startStepKey: string }) {
  const { runId, startStepKey } = params
  const now = new Date()
  const run = await prisma.run.findUnique({ where: { id: runId } })
  if (!run) throw new Error("Run not found")
  const snap = workflowSnapshotSchema.parse(JSON.parse(run.workflowSnap))

  // Build downstream set (including start).
  const children = new Map<string, string[]>()
  for (const s of snap.steps) children.set(s.stepKey, [])
  for (const s of snap.steps) {
    for (const d of s.deps ?? []) {
      const arr = children.get(d) ?? []
      arr.push(s.stepKey)
      children.set(d, arr)
    }
  }

  const affected = new Set<string>()
  const stack = [startStepKey]
  while (stack.length) {
    const cur = stack.pop()!
    if (affected.has(cur)) continue
    affected.add(cur)
    for (const ch of children.get(cur) ?? []) stack.push(ch)
  }

  // IMPORTANT:
  // A restarted/forked run starts as RUNNING. The scheduler will immediately cancel/fail a run
  // if it sees any step in CANCELED/FAILED. If we only reset the "downstream" set, a sibling
  // or prerequisite step that was previously CANCELED/FAILED can cause the new run to end
  // immediately, and the restarted steps get marked SKIPPED.
  //
  // To avoid this, we also reset any non-SUCCEEDED prerequisites of the affected set.
  const depsByKey = new Map<string, string[]>()
  for (const s of snap.steps)
    depsByKey.set(
      s.stepKey,
      (s.deps ?? []).filter((d) => typeof d === "string"),
    )

  const prerequisites = new Set<string>()
  const depStack = [...affected]
  while (depStack.length) {
    const cur = depStack.pop()!
    for (const d of depsByKey.get(cur) ?? []) {
      if (prerequisites.has(d)) continue
      prerequisites.add(d)
      depStack.push(d)
    }
  }

  const prerequisiteKeys = [...prerequisites]
  const prerequisiteStatuses =
    prerequisiteKeys.length > 0
      ? await prisma.runStep.findMany({
          where: { runId, stepKey: { in: prerequisiteKeys } },
          select: { stepKey: true, status: true },
        })
      : []
  const nonSucceededPrereqs = new Set(
    prerequisiteStatuses.filter((s) => s.status !== StepStatus.SUCCEEDED).map((s) => String(s.stepKey)),
  )

  const toReset = new Set<string>([...affected, ...nonSucceededPrereqs])

  const forked = await forkRun({ sourceRunId: runId, now, forkKind: "restart_from_step", forkStepKey: startStepKey })
  await resetStepInFork({ runId: forked.newRunId, stepKeys: [...toReset], now, kind: "restart_from_step" })
  return { ok: true as const, newRunId: forked.newRunId }
}

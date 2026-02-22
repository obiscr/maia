import "server-only"

import { prisma } from "@/lib/server/db"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

function topoSortSteps<T extends { stepKey: string; depsJson: string; createdAt?: Date | string }>(steps: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const s of steps) byKey.set(s.stepKey, s)

  const deps = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  const out = new Map<string, string[]>()

  for (const s of steps) {
    let arr: string[] = []
    try {
      const parsed = JSON.parse(s.depsJson)
      if (Array.isArray(parsed)) arr = parsed.filter((x) => typeof x === "string")
    } catch {}
    const filtered = arr.filter((k) => byKey.has(k))
    deps.set(s.stepKey, filtered)
    indeg.set(s.stepKey, filtered.length)
    out.set(s.stepKey, [])
  }

  for (const [k, ds] of deps) for (const d of ds) out.get(d)!.push(k)

  const createdAtMs = (s: T) => {
    const d = s.createdAt instanceof Date ? s.createdAt : typeof s.createdAt === "string" ? new Date(s.createdAt) : null
    const ms = d ? d.getTime() : Number.POSITIVE_INFINITY
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
  }

  const ready: string[] = []
  for (const [k, n] of indeg) if (n === 0) ready.push(k)
  ready.sort((a, b) => createdAtMs(byKey.get(a)!) - createdAtMs(byKey.get(b)!) || a.localeCompare(b))

  const sorted: T[] = []
  while (ready.length) {
    const k = ready.shift()!
    sorted.push(byKey.get(k)!)
    for (const next of out.get(k) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1)
      if (indeg.get(next) === 0) {
        ready.push(next)
        ready.sort((a, b) => createdAtMs(byKey.get(a)!) - createdAtMs(byKey.get(b)!) || a.localeCompare(b))
      }
    }
  }

  if (sorted.length !== steps.length) {
    return [...steps].sort((a, b) => createdAtMs(a) - createdAtMs(b) || a.stepKey.localeCompare(b.stepKey))
  }
  return sorted
}

export async function getRunByPublicId(params: { viewerAuth: ViewerAuthContext; runId: string }) {
  const runPublicId = String(params.runId || "")
    .trim()
    .toLowerCase()
  const run = await prisma.run.findFirst({
    where: getRunFindFirstWhereByPublicId(params.viewerAuth, runPublicId),
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      forkedFromRunId: true,
      forkKind: true,
      forkStepKey: true,
      workflowVersionNumber: true,
      workflowName: true,
      workflowSnap: true,
      initialInput: true,
      status: true,
      cancelRequestedAt: true,
      cancelRequestedReason: true,
      failureCode: true,
      failureMessage: true,
      failureMetaJson: true,
      failureAt: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      jobRun: {
        select: {
          publicId: true,
          publicNumber: true,
          scheduledFor: true,
          createdAt: true,
          schedule: {
            select: {
              publicId: true,
              publicNumber: true,
              name: true,
              kind: true,
              cron: true,
              timezone: true,
              intervalMs: true,
            },
          },
          batch: {
            select: {
              publicId: true,
              publicNumber: true,
              name: true,
              status: true,
            },
          },
        },
      },
      workflow: { select: { publicId: true, publicNumber: true, name: true, description: true } },
    },
  })
  if (!run) return null

  const stepsRaw = await prisma.runStep.findMany({
    where: { runId: run.id },
    select: {
      stepKey: true,
      name: true,
      status: true,
      depsJson: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
    },
  })
  const steps = topoSortSteps(stepsRaw)

  let snap: ReturnType<typeof workflowSnapshotSchema.parse> | null = null
  try {
    snap = workflowSnapshotSchema.parse(JSON.parse(run.workflowSnap || "{}"))
  } catch {
    snap = null
  }

  return {
    id: run.publicId,
    publicId: run.publicId,
    publicNumber: run.publicNumber,
    forkedFromRunId: run.forkedFromRunId ?? null,
    forkKind: run.forkKind ?? null,
    forkStepKey: run.forkStepKey ?? null,
    workflowId: run.workflow?.publicId ?? null,
    workflow: run.workflow
      ? {
          id: run.workflow.publicId,
          publicId: run.workflow.publicId,
          publicNumber: run.workflow.publicNumber,
          name: run.workflow.name,
        }
      : null,
    workflowVersionNumber: run.workflowVersionNumber ?? null,
    workflowName: run.workflowName,
    workflowDescription: run.workflow?.description ?? null,
    workflowSnap: run.workflowSnap,
    reservedInitialInputKeys: snap?.reservedInitialInputKeys ?? null,
    initialInput: run.initialInput,
    status: run.status,
    cancelRequestedAt: run.cancelRequestedAt ?? null,
    cancelRequestedReason: run.cancelRequestedReason ?? null,
    failureCode: run.failureCode ?? null,
    failureMessage: run.failureMessage ?? null,
    failureMetaJson: run.failureMetaJson ?? null,
    failureAt: run.failureAt ?? null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    jobRunId: run.jobRun?.publicId ?? null,
    jobRun: run.jobRun
      ? {
          id: run.jobRun.publicId,
          publicId: run.jobRun.publicId,
          publicNumber: run.jobRun.publicNumber,
          scheduledFor: run.jobRun.scheduledFor,
          createdAt: run.jobRun.createdAt,
          scheduleId: run.jobRun.schedule?.publicId ?? null,
          schedule: run.jobRun.schedule
            ? {
                id: run.jobRun.schedule.publicId,
                publicId: run.jobRun.schedule.publicId,
                publicNumber: run.jobRun.schedule.publicNumber,
                name: run.jobRun.schedule.name,
                kind: run.jobRun.schedule.kind,
                cron: run.jobRun.schedule.cron,
                timezone: run.jobRun.schedule.timezone,
                intervalMs: run.jobRun.schedule.intervalMs,
              }
            : null,
          batchId: run.jobRun.batch?.publicId ?? null,
          batch: run.jobRun.batch
            ? {
                id: run.jobRun.batch.publicId,
                publicId: run.jobRun.batch.publicId,
                publicNumber: run.jobRun.batch.publicNumber,
                name: run.jobRun.batch.name,
                status: run.jobRun.batch.status,
              }
            : null,
        }
      : null,
    steps,
  }
}

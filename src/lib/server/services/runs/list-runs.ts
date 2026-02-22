import "server-only"

import { z } from "zod"

import type { Prisma, RunStatus, StepStatus } from "@prisma/client"
import { prisma } from "@/lib/server/db"
import { isRecord } from "@/lib/shared/lang/is-record"
import { getRunsListVisibilityWhere } from "@/lib/server/scopes/runs-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const listRunsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["PENDING_INPUTS", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>

export async function listRuns(params: { viewerAuth: ViewerAuthContext; query: ListRunsQuery }) {
  const { viewerAuth, query: qp } = params
  const whereBase =
    qp.q && qp.q.length
      ? {
          OR: [
            { publicId: { contains: qp.q } },
            { workflowName: { contains: qp.q } },
            { workflow: { publicId: { contains: qp.q } } },
          ],
        }
      : undefined

  const whereParts: Prisma.RunWhereInput[] = []
  const visibilityWhere = getRunsListVisibilityWhere(viewerAuth)
  if (visibilityWhere) whereParts.push(visibilityWhere)
  if (whereBase) whereParts.push(whereBase)
  const where = whereParts.length ? { AND: whereParts } : undefined

  const whereWithStatus = qp.status
    ? where
      ? { ...where, status: qp.status as RunStatus }
      : { status: qp.status as RunStatus }
    : where

  const orderBy = qp.sort === "CREATED_ASC" ? [{ createdAt: "asc" as const }] : [{ createdAt: "desc" as const }]
  const total = await prisma.run.count({ where: whereWithStatus })
  const runs = await prisma.run.findMany({
    where: whereWithStatus,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      workflowId: true,
      workflow: { select: { publicId: true } },
      workflowVersionNumber: true,
      workflowName: true,
      status: true,
      cancelRequestedAt: true,
      failureCode: true,
      failureMessage: true,
      failureMetaJson: true,
      failureAt: true,
      initialInput: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      _count: {
        select: {
          steps: true,
          attempts: true,
          artifacts: true,
        },
      },
    },
  })

  const runIds = runs.map((r) => r.id)
  const stepCountsByRun = new Map<string, Record<string, number>>()
  const specialStepNameByRun = new Map<string, { running: string | null; failed: string | null }>()

  if (runIds.length) {
    const stepCounts = await prisma.runStep.groupBy({
      by: ["runId", "status"],
      where: { runId: { in: runIds } },
      _count: { _all: true },
    })
    for (const row of stepCounts) {
      const m = stepCountsByRun.get(row.runId) ?? {}
      m[String(row.status)] = Number(row._count?._all ?? 0)
      stepCountsByRun.set(row.runId, m)
    }

    const special = await prisma.runStep.findMany({
      where: { runId: { in: runIds }, status: { in: ["RUNNING", "FAILED"] as StepStatus[] } },
      select: { runId: true, status: true, name: true, stepKey: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }],
    })
    for (const s of special) {
      const cur = specialStepNameByRun.get(s.runId) ?? { running: null, failed: null }
      const st = String(s.status)
      if (st === "RUNNING" && !cur.running) cur.running = s.name ?? s.stepKey
      if (st === "FAILED" && !cur.failed) cur.failed = s.name ?? s.stepKey
      specialStepNameByRun.set(s.runId, cur)
    }
  }

  const parseInputCounts = (initialInputRaw: string | null | undefined) => {
    const raw = typeof initialInputRaw === "string" ? initialInputRaw : "{}"
    try {
      const parsed = JSON.parse(raw)
      if (!isRecord(parsed)) return { paramsCount: 0, filesCount: 0 }
      const files = Array.isArray(parsed.files) ? (parsed.files as unknown[]) : []
      const keys = Object.keys(parsed).filter((k) => k !== "files")
      return { paramsCount: keys.length, filesCount: files.length }
    } catch {
      return { paramsCount: 0, filesCount: 0 }
    }
  }

  const runsPayload = runs.map((r) => {
    const inputCounts = parseInputCounts(r.initialInput)
    const stepsTotal = Number(r._count?.steps ?? 0)
    const counts = stepCountsByRun.get(r.id) ?? {}
    const done =
      Number(counts.SUCCEEDED ?? 0) +
      Number(counts.FAILED ?? 0) +
      Number(counts.CANCELED ?? 0) +
      Number(counts.SKIPPED ?? 0)
    const special = specialStepNameByRun.get(r.id) ?? { running: null, failed: null }
    return {
      id: r.publicId,
      publicId: r.publicId,
      publicNumber: r.publicNumber,
      workflowId: r.workflow?.publicId ?? null,
      workflowName: r.workflowName,
      workflowVersionNumber: r.workflowVersionNumber ?? null,
      status: r.status,
      cancelRequestedAt: r.cancelRequestedAt ?? null,
      failureCode: r.failureCode ?? null,
      failureMessage: r.failureMessage ?? null,
      failureMetaJson: r.failureMetaJson ?? null,
      failureAt: r.failureAt ?? null,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      stepsTotal,
      stepsDone: stepsTotal ? Math.min(done, stepsTotal) : 0,
      runningStepName: special.running,
      failedStepName: special.failed,
      inputParamsCount: inputCounts.paramsCount,
      inputFilesCount: inputCounts.filesCount,
      artifactsCount: Number(r._count?.artifacts ?? 0),
      attemptsCount: Number(r._count?.attempts ?? 0),
    }
  })

  return {
    runs: runsPayload,
    total,
    page: qp.page,
    pageSize: qp.pageSize,
    sort: qp.sort,
    q: qp.q ?? "",
    status: qp.status ?? null,
  }
}

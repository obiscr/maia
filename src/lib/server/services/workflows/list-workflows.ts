import "server-only"

import { z } from "zod"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { depsHash, parseDependenciesJson } from "@/lib/server/maia/deps"
import { getWorkflowsListVisibilityWhere } from "@/lib/server/scopes/workflows-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const listWorkflowsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["UPDATED_DESC", "UPDATED_ASC"]).default("UPDATED_DESC"),
  depsStatus: z.enum(["IDLE", "INSTALLING", "READY", "FAILED"]).optional(),
  envConfigured: z.enum(["CONFIGURED", "NOT_CONFIGURED"]).optional(),
  inputSpecConfigured: z.enum(["CONFIGURED", "NOT_CONFIGURED"]).optional(),
  outputsSpecConfigured: z.enum(["CONFIGURED", "NOT_CONFIGURED"]).optional(),
})

export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>

export async function listWorkflows(params: { viewerAuth: ViewerAuthContext; query: ListWorkflowsQuery }) {
  const { viewerAuth, query: qp } = params

  const where: Prisma.WorkflowWhereInput | undefined = (() => {
    const parts: Prisma.WorkflowWhereInput[] = []
    const visibilityWhere = getWorkflowsListVisibilityWhere(viewerAuth)
    if (visibilityWhere) parts.push(visibilityWhere)
    if (qp.q && qp.q.length) {
      parts.push({
        OR: [{ publicId: { contains: qp.q } }, { name: { contains: qp.q } }, { description: { contains: qp.q } }],
      })
    }
    if (qp.depsStatus) parts.push({ depsStatus: qp.depsStatus })
    if (qp.envConfigured) {
      parts.push(qp.envConfigured === "CONFIGURED" ? { envJson: { not: "{}" } } : { envJson: { equals: "{}" } })
    }
    if (qp.inputSpecConfigured) {
      parts.push(qp.inputSpecConfigured === "CONFIGURED" ? { inputSpec: { not: null } } : { inputSpec: null })
    }
    if (qp.outputsSpecConfigured) {
      parts.push(qp.outputsSpecConfigured === "CONFIGURED" ? { outputsSpec: { not: null } } : { outputsSpec: null })
    }
    if (!parts.length) return undefined
    if (parts.length === 1) return parts[0]
    return { AND: parts }
  })()

  const orderBy = qp.sort === "UPDATED_ASC" ? [{ updatedAt: "asc" as const }] : [{ updatedAt: "desc" as const }]
  const totalAll = await prisma.workflow.count({ where: getWorkflowsListVisibilityWhere(viewerAuth) })
  const total = await prisma.workflow.count({ where })
  const workflows = await prisma.workflow.findMany({
    where,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      description: true,
      dependencies: true,
      envJson: true,
      inputSpec: true,
      outputsSpec: true,
      depsHash: true,
      depsStatus: true,
      depsErrorCode: true,
      depsErrorMessage: true,
      depsErrorMetaJson: true,
      depsErrorAt: true,
      depsUpdatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  const ids = workflows.map((w) => w.id)
  if (ids.length === 0) {
    return {
      workflows: [],
      total,
      totalAll,
      page: qp.page,
      pageSize: qp.pageSize,
      sort: qp.sort,
      q: qp.q ?? "",
      envConfigured: qp.envConfigured ?? null,
      inputSpecConfigured: qp.inputSpecConfigured ?? null,
      outputsSpecConfigured: qp.outputsSpecConfigured ?? null,
    }
  }

  const stepCounts = await prisma.workflowStep.groupBy({
    by: ["workflowId"],
    where: { workflowId: { in: ids } },
    _count: { _all: true },
  })
  const runCounts = await prisma.run.groupBy({
    by: ["workflowId"],
    where: { workflowId: { in: ids } },
    _count: { _all: true },
  })
  const runningCounts = await prisma.run.groupBy({
    by: ["workflowId"],
    where: { workflowId: { in: ids }, status: "RUNNING" },
    _count: { _all: true },
  })
  const latestVersions = await prisma.workflowVersion.groupBy({
    by: ["workflowId"],
    where: { workflowId: { in: ids } },
    _max: { version: true },
  })

  const RECENT_N = 20
  const idList = Prisma.join(ids)
  type LastRunRow = {
    workflowId: string
    publicId: string
    status: string
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
    workflowVersionNumber: number | null
  }
  const lastRuns = await prisma.$queryRaw<LastRunRow[]>(
    Prisma.sql`
      SELECT workflowId, publicId, status, createdAt, startedAt, finishedAt, workflowVersionNumber
      FROM (
        SELECT
          workflowId,
          publicId,
          status,
          createdAt,
          startedAt,
          finishedAt,
          workflowVersionNumber,
          ROW_NUMBER() OVER (PARTITION BY workflowId ORDER BY createdAt DESC) as rn
        FROM Run
        WHERE workflowId IN (${idList})
      )
      WHERE rn = 1
    `,
  )

  type RecentStatusRow = { workflowId: string; status: string }
  const recentStatuses = await prisma.$queryRaw<RecentStatusRow[]>(
    Prisma.sql`
      SELECT workflowId, status
      FROM (
        SELECT
          workflowId,
          status,
          ROW_NUMBER() OVER (PARTITION BY workflowId ORDER BY createdAt DESC) as rn
        FROM Run
        WHERE workflowId IN (${idList})
      )
      WHERE rn <= ${RECENT_N}
    `,
  )

  const stepMap = new Map(stepCounts.map((r) => [r.workflowId, r._count._all]))
  const runMap = new Map(runCounts.map((r) => [r.workflowId, r._count._all]))
  const runningMap = new Map(runningCounts.map((r) => [r.workflowId, r._count._all]))
  const latestVerMap = new Map(latestVersions.map((r) => [r.workflowId, Number(r._max?.version ?? 0) || 0]))
  const lastRunMap = new Map<string, LastRunRow>()
  for (const r of lastRuns) lastRunMap.set(r.workflowId, r)

  const recentStatsMap = new Map<
    string,
    { completed: number; succeeded: number; pct: number | null; sampleN: number }
  >()
  for (const row of recentStatuses) {
    const cur = recentStatsMap.get(row.workflowId) ?? {
      completed: 0,
      succeeded: 0,
      pct: null as number | null,
      sampleN: 0,
    }
    cur.sampleN += 1
    const st = String(row.status || "").toUpperCase()
    const isCompleted = st === "SUCCEEDED" || st === "FAILED" || st === "CANCELED"
    if (isCompleted) {
      cur.completed += 1
      if (st === "SUCCEEDED") cur.succeeded += 1
    }
    recentStatsMap.set(row.workflowId, cur)
  }
  for (const [k, v] of recentStatsMap.entries()) {
    v.pct = v.completed > 0 ? Math.round((v.succeeded / v.completed) * 100) : null
    recentStatsMap.set(k, v)
  }

  const depsCountFor = (raw: string) => {
    try {
      const obj = parseDependenciesJson(raw ?? "{}")
      return Object.keys(obj).length
    } catch {
      return 0
    }
  }

  const envCountFor = (raw: string) => {
    const txt = typeof raw === "string" ? raw : "{}"
    try {
      const parsed = JSON.parse(txt)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0
      return Object.keys(parsed as Record<string, unknown>).length
    } catch {
      return 0
    }
  }

  return {
    workflows: workflows.map((w) => {
      const { inputSpec, outputsSpec, id: internalId, publicId, publicNumber, ...rest } = w
      const hasInputSpec = typeof inputSpec === "string" && inputSpec.trim().length > 0
      const hasOutputsSpec = typeof outputsSpec === "string" && outputsSpec.trim().length > 0
      const lastRun = lastRunMap.get(internalId) ?? null
      const recent = recentStatsMap.get(internalId) ?? {
        completed: 0,
        succeeded: 0,
        pct: null as number | null,
        sampleN: 0,
      }
      return {
        id: publicId,
        publicId,
        publicNumber,
        ...rest,
        hasInputSpec,
        hasOutputsSpec,
        latestVersionNumber: latestVerMap.get(internalId) ?? 0,
        lastRun: lastRun
          ? {
              id: lastRun.publicId,
              publicId: lastRun.publicId,
              status: lastRun.status,
              createdAt: lastRun.createdAt,
              startedAt: lastRun.startedAt,
              finishedAt: lastRun.finishedAt,
              workflowVersionNumber: lastRun.workflowVersionNumber ?? null,
            }
          : null,
        recentSuccessRatePct: recent.pct,
        recentSuccessRateCompleted: recent.completed,
        recentSuccessRateN: RECENT_N,
        stepCount: stepMap.get(internalId) ?? 0,
        runCount: runMap.get(internalId) ?? 0,
        runningRunCount: runningMap.get(internalId) ?? 0,
        npmDepsCount: depsCountFor(w.dependencies),
        envCount: envCountFor(w.envJson),
      }
    }),
    total,
    totalAll,
    page: qp.page,
    pageSize: qp.pageSize,
    sort: qp.sort,
    q: qp.q ?? "",
    envConfigured: qp.envConfigured ?? null,
    inputSpecConfigured: qp.inputSpecConfigured ?? null,
    outputsSpecConfigured: qp.outputsSpecConfigured ?? null,
  }
}

export function computeDepsHash(dependencies: string): string {
  return depsHash(parseDependenciesJson(dependencies))
}

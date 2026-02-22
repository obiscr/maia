import "server-only"

import { z } from "zod"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { isRecord } from "@/lib/shared/lang/is-record"
import { getBatchesListVisibilityWhere } from "@/lib/server/scopes/batches-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

type JobRunStatusKey = "QUEUED" | "PAUSED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED"
const JOB_RUN_STATUS_KEYS: ReadonlyArray<JobRunStatusKey> = [
  "QUEUED",
  "PAUSED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
] as const
function emptyJobsByStatus(): Record<JobRunStatusKey, number> {
  return { QUEUED: 0, PAUSED: 0, RUNNING: 0, SUCCEEDED: 0, FAILED: 0, CANCELED: 0 }
}

export const listBatchesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["CREATED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>

export async function listBatches(params: { viewerAuth: ViewerAuthContext; query: ListBatchesQuery }) {
  const { viewerAuth, query: qp } = params
  const whereBase =
    qp.q && qp.q.length
      ? {
          OR: [
            { publicId: { contains: qp.q } },
            { name: { contains: qp.q } },
            { workflow: { publicId: { contains: qp.q } } },
            { workflow: { name: { contains: qp.q } } },
          ],
        }
      : undefined
  const whereParts: Prisma.BatchWhereInput[] = []
  const visibilityWhere = getBatchesListVisibilityWhere(viewerAuth)
  if (visibilityWhere) whereParts.push(visibilityWhere)
  if (whereBase) whereParts.push(whereBase)
  const whereScoped = whereParts.length ? { AND: whereParts } : undefined
  const whereWithStatus = qp.status
    ? whereScoped
      ? { ...whereScoped, status: qp.status }
      : { status: qp.status }
    : whereScoped
  const orderBy = qp.sort === "CREATED_ASC" ? [{ createdAt: "asc" as const }] : [{ createdAt: "desc" as const }]
  const total = await prisma.batch.count({ where: whereWithStatus })
  const batches = await prisma.batch.findMany({
    where: whereWithStatus,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      status: true,
      workflowId: true,
      workflow: { select: { name: true, publicId: true } },
      pinnedWorkflowVersion: { select: { version: true } },
      concurrencyLimit: true,
      rampUpSeconds: true,
      autoMaxConcurrency: true,
      failFast: true,
      maxFailures: true,
      sourceJson: true,
      urlFilesJson: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      _count: { select: { jobRuns: true } },
    },
  })
  const internalBatchIds = batches.map((b) => b.id).filter(Boolean)
  const jobsByBatchStatus =
    internalBatchIds.length > 0
      ? await prisma.jobRun.groupBy({
          by: ["batchId", "status"],
          where: { batchId: { in: internalBatchIds } },
          _count: { _all: true },
        })
      : []
  const jobsByBatchId = new Map<string, Record<JobRunStatusKey, number>>()
  for (const row of jobsByBatchStatus) {
    const batchId = String(row.batchId)
    const statusKeyRaw = String(row.status)
    const n = Number(row._count?._all ?? 0) || 0
    const cur = jobsByBatchId.get(batchId) ?? emptyJobsByStatus()
    if ((JOB_RUN_STATUS_KEYS as readonly string[]).includes(statusKeyRaw)) {
      jobsByBatchId.set(batchId, { ...cur, [statusKeyRaw as JobRunStatusKey]: n })
    } else {
      jobsByBatchId.set(batchId, cur)
    }
  }
  return {
    total,
    batches: batches.map((b) => ({
      id: b.publicId,
      publicId: b.publicId,
      publicNumber: b.publicNumber,
      name: b.name,
      status: b.status,
      workflowId: b.workflow?.publicId ?? null,
      workflowName: b.workflow?.name ?? "—",
      pinnedWorkflowVersionNumber: b.pinnedWorkflowVersion?.version ?? null,
      concurrencyLimit: typeof b.concurrencyLimit === "number" ? b.concurrencyLimit : null,
      rampUpSeconds: typeof b.rampUpSeconds === "number" ? b.rampUpSeconds : null,
      autoMaxConcurrency: typeof b.autoMaxConcurrency === "number" ? b.autoMaxConcurrency : null,
      failFast: Boolean(b.failFast),
      maxFailures: typeof b.maxFailures === "number" ? b.maxFailures : null,
      urlFilesCount: (() => {
        try {
          const parsed = JSON.parse(String(b.urlFilesJson ?? "[]"))
          return Array.isArray(parsed) ? parsed.length : 0
        } catch {
          return 0
        }
      })(),
      provenance: (() => {
        try {
          const raw = JSON.parse(String(b.sourceJson ?? "{}"))
          if (!isRecord(raw)) return null
          const pick = (k: string) => {
            const v = raw[k]
            if (v == null) return null
            const s = String(v).trim()
            return s ? s.slice(0, 200) : null
          }
          return { source: pick("source"), owner: pick("owner"), ticket: pick("ticket"), dataset: pick("dataset") }
        } catch {
          return null
        }
      })(),
      createdAt: b.createdAt,
      startedAt: b.startedAt,
      finishedAt: b.finishedAt,
      jobsTotal: b._count.jobRuns,
      jobsByStatus: jobsByBatchId.get(b.id) ?? emptyJobsByStatus(),
    })),
  }
}

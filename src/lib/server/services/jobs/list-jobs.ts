import "server-only"

import { z } from "zod"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { getBatchFindFirstWhereByPublicId } from "@/lib/server/scopes/batches-scope"
import { getJobRunsListVisibilityWhere } from "@/lib/server/scopes/jobs-scope"
import { getScheduleFindFirstWhereByPublicId } from "@/lib/server/scopes/schedules-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const listJobsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["QUEUED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
  scheduleId: z.string().trim().min(1).optional(),
  batchId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>

export async function listJobs(params: { viewerAuth: ViewerAuthContext; query: ListJobsQuery }) {
  const { viewerAuth, query: qp } = params
  const andParts: Prisma.JobRunWhereInput[] = []
  const visibilityWhere = getJobRunsListVisibilityWhere(viewerAuth)
  if (visibilityWhere) andParts.push(visibilityWhere)

  if (qp.scheduleId) {
    const schedulePublicId = String(qp.scheduleId || "")
      .trim()
      .toLowerCase()
    const s = await prisma.schedule.findFirst({
      where: getScheduleFindFirstWhereByPublicId(viewerAuth, schedulePublicId),
      select: { id: true },
    })
    if (!s) {
      return {
        total: 0,
        jobs: [],
        page: qp.page,
        pageSize: qp.pageSize,
        sort: qp.sort,
        q: qp.q ?? "",
        status: qp.status ?? null,
      }
    }
    andParts.push({ scheduleId: s.id })
  }

  if (qp.batchId) {
    const batchPublicId = String(qp.batchId || "")
      .trim()
      .toLowerCase()
    const b = await prisma.batch.findFirst({
      where: getBatchFindFirstWhereByPublicId(viewerAuth, batchPublicId),
      select: { id: true },
    })
    if (!b) {
      return {
        total: 0,
        jobs: [],
        page: qp.page,
        pageSize: qp.pageSize,
        sort: qp.sort,
        q: qp.q ?? "",
        status: qp.status ?? null,
      }
    }
    andParts.push({ batchId: b.id })
  }

  if (qp.q && qp.q.length) {
    andParts.push({
      OR: [
        { publicId: { contains: qp.q } },
        { run: { publicId: { contains: qp.q } } },
        { workflow: { publicId: { contains: qp.q } } },
        { workflow: { name: { contains: qp.q } } },
      ],
    })
  }
  if (qp.status) andParts.push({ status: qp.status })

  const where = andParts.length ? { AND: andParts } : undefined
  const orderBy = qp.sort === "CREATED_ASC" ? [{ queuedAt: "asc" as const }] : [{ queuedAt: "desc" as const }]

  const total = await prisma.jobRun.count({ where })
  const jobs = await prisma.jobRun.findMany({
    where,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      status: true,
      cancelRequestedAt: true,
      cancelRequestedReason: true,
      workflowId: true,
      workflow: { select: { name: true, publicId: true } },
      scheduleId: true,
      schedule: { select: { name: true, publicId: true } },
      batchId: true,
      batch: { select: { name: true, publicId: true } },
      scheduledFor: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
      claimedBy: true,
      claimedAt: true,
      leaseExpiresAt: true,
      attemptCount: true,
      maxAttempts: true,
      nextAttemptAt: true,
      runId: true,
      run: { select: { publicId: true, status: true, cancelRequestedAt: true } },
      lastErrorCode: true,
      lastErrorMessage: true,
      lastErrorMetaJson: true,
      lastErrorAt: true,
    },
  })

  return {
    total,
    jobs: jobs.map((j) => ({
      id: j.publicId,
      publicId: j.publicId,
      publicNumber: j.publicNumber,
      status: j.status,
      cancelRequestedAt: j.cancelRequestedAt ?? null,
      cancelRequestedReason: j.cancelRequestedReason ?? null,
      workflowId: j.workflow?.publicId ?? null,
      workflowName: j.workflow?.name ?? "—",
      scheduleId: j.schedule?.publicId ?? null,
      scheduleName: j.schedule?.name ?? null,
      batchId: j.batch?.publicId ?? null,
      batchName: j.batch?.name ?? null,
      scheduledFor: j.scheduledFor,
      queuedAt: j.queuedAt,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      claimedBy: j.claimedBy,
      claimedAt: j.claimedAt,
      leaseExpiresAt: j.leaseExpiresAt,
      attemptCount: j.attemptCount,
      maxAttempts: j.maxAttempts,
      nextAttemptAt: j.nextAttemptAt,
      runId: j.run?.publicId ?? null,
      runStatus: j.run?.status ?? null,
      runCancelRequestedAt: j.run?.cancelRequestedAt ?? null,
      lastErrorCode: j.lastErrorCode ?? null,
      lastErrorMessage: j.lastErrorMessage ?? null,
      lastErrorMetaJson: j.lastErrorMetaJson ?? null,
      lastErrorAt: j.lastErrorAt ?? null,
    })),
    page: qp.page,
    pageSize: qp.pageSize,
    sort: qp.sort,
    q: qp.q ?? "",
    status: qp.status ?? null,
  }
}

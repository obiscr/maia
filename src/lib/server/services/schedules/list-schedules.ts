import "server-only"

import { z } from "zod"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { getSchedulesListVisibilityWhere } from "@/lib/server/scopes/schedules-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const listSchedulesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["ENABLED", "DISABLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

export type ListSchedulesQuery = z.infer<typeof listSchedulesQuerySchema>

export async function listSchedules(params: { viewerAuth: ViewerAuthContext; query: ListSchedulesQuery }) {
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

  const whereParts: Prisma.ScheduleWhereInput[] = []
  const visibilityWhere = getSchedulesListVisibilityWhere(viewerAuth)
  if (visibilityWhere) whereParts.push(visibilityWhere)
  if (whereBase) whereParts.push(whereBase)
  const where = whereParts.length ? { AND: whereParts } : undefined

  const whereWithStatus =
    qp.status === "ENABLED"
      ? where
        ? { ...where, enabled: true }
        : { enabled: true }
      : qp.status === "DISABLED"
        ? where
          ? { ...where, enabled: false }
          : { enabled: false }
        : where

  const orderBy = qp.sort === "CREATED_ASC" ? [{ createdAt: "asc" as const }] : [{ createdAt: "desc" as const }]

  const total = await prisma.schedule.count({ where: whereWithStatus })
  const schedules = await prisma.schedule.findMany({
    where: whereWithStatus,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      enabled: true,
      workflowId: true,
      workflow: { select: { name: true, publicId: true } },
      kind: true,
      cron: true,
      timezone: true,
      intervalMs: true,
      inputJson: true,
      nextRunAt: true,
      lastRunAt: true,
      lastFireJobRunId: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  const lastFireInternalJobRunIds = schedules
    .map((s) => s.lastFireJobRunId)
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
  const lastFireJobRuns =
    lastFireInternalJobRunIds.length > 0
      ? await prisma.jobRun.findMany({
          where: { id: { in: lastFireInternalJobRunIds } },
          select: { id: true, publicId: true, run: { select: { publicId: true } } },
        })
      : []
  const lastFireJobRunById = new Map(lastFireJobRuns.map((j) => [j.id, j]))

  return {
    total,
    schedules: schedules.map((s) => ({
      id: s.publicId,
      publicId: s.publicId,
      publicNumber: s.publicNumber,
      name: s.name,
      enabled: s.enabled,
      workflowId: s.workflow?.publicId ?? null,
      workflowName: s.workflow?.name ?? "—",
      lastJobId: s.lastFireJobRunId ? (lastFireJobRunById.get(s.lastFireJobRunId)?.publicId ?? null) : null,
      lastRunId: s.lastFireJobRunId ? (lastFireJobRunById.get(s.lastFireJobRunId)?.run?.publicId ?? null) : null,
      kind: s.kind,
      cron: s.cron,
      timezone: s.timezone,
      intervalMs: s.intervalMs,
      inputJson: s.inputJson,
      nextRunAt: s.nextRunAt,
      lastRunAt: s.lastRunAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  }
}

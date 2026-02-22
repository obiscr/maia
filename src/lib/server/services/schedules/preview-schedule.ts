import "server-only"

import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { nextCronAfter, nextIntervalAfter } from "@/lib/server/maia/scheduler"
import type { RequestAuthContext } from "@/lib/server/authz"
import { isAdmin } from "@/lib/server/authz"

export const previewScheduleQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
})

function computeNextTimes(opts: {
  limit: number
  kind: string
  cron: string | null
  timezone: string | null
  intervalMs: number | null
  lastRunAt: Date | null
  createdAt: Date | null
  now: Date
}) {
  const out: Date[] = []
  const limit = Math.max(1, Math.min(20, Math.floor(opts.limit)))
  const kind = String(opts.kind ?? "").toUpperCase()
  if (kind === "INTERVAL") {
    const ms = typeof opts.intervalMs === "number" ? opts.intervalMs : null
    if (!ms || !Number.isFinite(ms) || ms < 1000) return out
    const anchor = opts.lastRunAt ?? opts.createdAt ?? opts.now
    let cur = nextIntervalAfter(new Date(anchor), ms, opts.now)
    for (let i = 0; i < limit; i++) {
      out.push(cur)
      cur = nextIntervalAfter(new Date(anchor), ms, cur)
    }
    return out
  }
  const expr = String(opts.cron ?? "").trim()
  if (!expr) return out
  const tz = String(opts.timezone ?? "UTC") || "UTC"
  let cur = nextCronAfter(opts.now, expr, tz)
  for (let i = 0; i < limit; i++) {
    if (!cur) break
    out.push(cur)
    cur = nextCronAfter(cur, expr, tz)
  }
  return out
}

export async function previewScheduleByPublicId(params: {
  auth: RequestAuthContext
  scheduleId: string
  query: z.infer<typeof previewScheduleQuerySchema>
}) {
  const schedulePublicId = String(params.scheduleId || "")
    .trim()
    .toLowerCase()
  const schedule = await prisma.schedule.findFirst({
    where: { publicId: schedulePublicId, ...(isAdmin(params.auth) ? {} : { ownerUserId: params.auth.userId }) },
    select: {
      id: true,
      enabled: true,
      kind: true,
      cron: true,
      timezone: true,
      intervalMs: true,
      lastRunAt: true,
      createdAt: true,
      nextRunAt: true,
      updatedAt: true,
    },
  })
  if (!schedule) return null
  const now = new Date()
  const times = computeNextTimes({
    limit: params.query.limit,
    kind: String(schedule.kind),
    cron: schedule.cron,
    timezone: schedule.timezone,
    intervalMs: schedule.intervalMs,
    lastRunAt: schedule.lastRunAt,
    createdAt: schedule.createdAt,
    now,
  })
  return {
    scheduleId: schedulePublicId,
    enabled: schedule.enabled,
    kind: schedule.kind,
    nextRunAt: schedule.nextRunAt,
    generatedAt: now,
    times,
  }
}

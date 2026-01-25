import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { nextCronAfter, nextIntervalAfter } from "@/lib/server/maia/scheduler"
import { zodIssues } from "@/lib/shared/http/zod"
import { z } from "zod"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"

export const runtime = "nodejs"

const querySchema = z.object({
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

export const GET = withApiObservability(async (req: Request, ctx: { params: Promise<{ scheduleId: string }> }) => {
  const auth = requireRequestAuth()
  const { scheduleId } = await ctx.params
  const schedulePublicId = String(scheduleId || "")
    .trim()
    .toLowerCase()
  const url = new URL(req.url)

  let qp: z.infer<typeof querySchema>
  try {
    qp = querySchema.parse({ limit: url.searchParams.get("limit") ?? undefined })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  const schedule = await prisma.schedule.findFirst({
    where: { publicId: schedulePublicId, ...(isAdmin(auth) ? {} : { ownerUserId: auth.userId }) },
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
  if (!schedule) return notFound("NOT_FOUND")

  const now = new Date()
  const times = computeNextTimes({
    limit: qp.limit,
    kind: String(schedule.kind),
    cron: schedule.cron,
    timezone: schedule.timezone,
    intervalMs: schedule.intervalMs,
    lastRunAt: schedule.lastRunAt,
    createdAt: schedule.createdAt,
    now,
  })

  return ok({
    scheduleId: schedulePublicId,
    enabled: schedule.enabled,
    kind: schedule.kind,
    nextRunAt: schedule.nextRunAt,
    generatedAt: now,
    times,
  })
})

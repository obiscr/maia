import "server-only"

import crypto from "crypto"

import { JobRunStatus, ScheduleKind, ScheduleMisfirePolicy, ScheduleOverlapPolicy } from "@prisma/client"
import type { Prisma } from "@prisma/client"
import { allocatePublicId } from "@/lib/server/public-ids"
import { mergeUrlInputFilesIntoInputJson, parseStoredUrlFilesJson, toUrlInputFiles } from "@/lib/server/maia/url-files"

const MAX_CRON_SEARCH_MINUTES = 60 * 24 * 366 // 1 year horizon

type CronParts = {
  minutes: Set<number>
  hours: Set<number>
  dom: Set<number> | null // null means "*"
  months: Set<number>
  dow: Set<number> | null // null means "*"
  domIsAny: boolean
  dowIsAny: boolean
}

export function validateCronExpression(expr: string) {
  // Throws on invalid cron expression (5-field Vixie cron).
  // Keep this as a fast parse-only validation (no search).
  parseCron(expr)
  return true
}

function parseCronField(field: string, min: number, max: number, opts?: { map7To0?: boolean }) {
  const out = new Set<number>()
  const raw = String(field ?? "").trim()
  if (!raw) throw new Error("Invalid cron field")
  const parts = raw.split(",")
  for (const p of parts) {
    const part = p.trim()
    if (!part) continue
    if (part === "*") {
      for (let i = min; i <= max; i++) out.add(i)
      continue
    }
    const stepSplit = part.split("/")
    const base = stepSplit[0]!
    const step = stepSplit.length > 1 ? Number(stepSplit[1]) : 1
    if (!Number.isFinite(step) || step <= 0) throw new Error("Invalid cron step")

    const addRange = (a: number, b: number) => {
      const start = Math.min(a, b)
      const end = Math.max(a, b)
      for (let i = start; i <= end; i += step) out.add(i)
    }

    if (base === "*") {
      addRange(min, max)
      continue
    }

    if (base.includes("-")) {
      const [a, b] = base.split("-")
      const na = Number(a)
      const nb = Number(b)
      if (!Number.isFinite(na) || !Number.isFinite(nb)) throw new Error("Invalid cron range")
      addRange(na, nb)
      continue
    }

    const n = Number(base)
    if (!Number.isFinite(n)) throw new Error("Invalid cron number")
    out.add(n)
  }

  const mapped = new Set<number>()
  for (const n of out) {
    let v = n
    if (opts?.map7To0 && v === 7) v = 0
    if (!Number.isFinite(v) || v < min || v > max) continue
    mapped.add(v)
  }
  if (mapped.size === 0) throw new Error("Empty cron field")
  return mapped
}

function parseCron(expr: string): CronParts {
  const fields = String(expr ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (fields.length !== 5) throw new Error("Cron must have 5 fields: min hour dom mon dow")
  const [minF, hourF, domF, monF, dowF] = fields
  const domIsAny = domF === "*"
  const dowIsAny = dowF === "*"
  return {
    minutes: parseCronField(minF, 0, 59),
    hours: parseCronField(hourF, 0, 23),
    dom: domIsAny ? null : parseCronField(domF, 1, 31),
    months: parseCronField(monF, 1, 12),
    dow: dowIsAny ? null : parseCronField(dowF, 0, 7, { map7To0: true }),
    domIsAny,
    dowIsAny,
  }
}

function zonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  })
  const parts = dtf.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value
  const weekday = String(get("weekday") ?? "").slice(0, 3)
  const dow =
    weekday === "Sun"
      ? 0
      : weekday === "Mon"
        ? 1
        : weekday === "Tue"
          ? 2
          : weekday === "Wed"
            ? 3
            : weekday === "Thu"
              ? 4
              : weekday === "Fri"
                ? 5
                : weekday === "Sat"
                  ? 6
                  : 0
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    dow,
  }
}

function cronMatches(cron: CronParts, date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone)
  if (!cron.minutes.has(p.minute)) return false
  if (!cron.hours.has(p.hour)) return false
  if (!cron.months.has(p.month)) return false

  const domOk = cron.dom == null ? true : cron.dom.has(p.day)
  const dowOk = cron.dow == null ? true : cron.dow.has(p.dow)

  // Vixie cron semantics: if either DOM or DOW is "*", the other is used.
  // If both are restricted, match when either matches.
  if (cron.domIsAny && cron.dowIsAny) return true
  if (cron.domIsAny) return dowOk
  if (cron.dowIsAny) return domOk
  return domOk || dowOk
}

function ceilToNextMinute(d: Date) {
  const out = new Date(d.getTime())
  out.setSeconds(0, 0)
  out.setMinutes(out.getMinutes() + 1)
  return out
}

export function nextCronAfter(now: Date, expr: string, timeZone: string) {
  const cron = parseCron(expr)
  let cur = ceilToNextMinute(now)
  for (let i = 0; i < MAX_CRON_SEARCH_MINUTES; i++) {
    if (cronMatches(cron, cur, timeZone)) return cur
    cur = new Date(cur.getTime() + 60_000)
  }
  return null
}

export function nextIntervalAfter(anchor: Date, intervalMs: number, now: Date) {
  const base = anchor.getTime()
  const ms = Math.max(1, intervalMs)
  const delta = now.getTime() - base
  const k = delta >= 0 ? Math.floor(delta / ms) + 1 : 1
  return new Date(base + k * ms)
}

export type ScheduleLike = {
  kind: ScheduleKind
  cron: string | null
  timezone: string | null
  intervalMs: number | null
  nextRunAt: Date | null
  lastRunAt: Date | null
  createdAt: Date | null
}

export function computeNextRunAt(schedule: ScheduleLike, from: Date) {
  const tz = String(schedule.timezone || "UTC") || "UTC"
  const compute = (t: Date) => {
    if (schedule.kind === ScheduleKind.INTERVAL) {
      const ms = typeof schedule.intervalMs === "number" ? schedule.intervalMs : 60_000
      const anchor = schedule.lastRunAt ?? schedule.createdAt ?? t
      return nextIntervalAfter(new Date(anchor), ms, t)
    }
    const expr = String(schedule.cron ?? "").trim() || "0 * * * *"
    return nextCronAfter(t, expr, tz)
  }

  // When initializing a new schedule, nextRunAt can be null; compute from "from".
  const cur = schedule.nextRunAt ? new Date(schedule.nextRunAt) : compute(from)
  return cur ? new Date(cur) : null
}

export type ProcessSchedulesResult = {
  /**
   * Internal (UUID) schedule ids that were updated in this tick.
   * Emit realtime events AFTER the transaction commits.
   */
  touchedScheduleIds: string[]
  /**
   * Internal (UUID) jobRun ids created in this tick.
   * Emit realtime events AFTER the transaction commits.
   */
  createdJobRunIds: string[]
}

export async function processSchedules(tx: Prisma.TransactionClient, now: Date): Promise<ProcessSchedulesResult> {
  const touchedScheduleIds = new Set<string>()
  const createdJobRunIds: string[] = []

  const schedules = await tx.schedule.findMany({
    where: { enabled: true },
    orderBy: [{ nextRunAt: "asc" }],
    take: 50,
    select: {
      id: true,
      enabled: true,
      workflowId: true,
      pinnedWorkflowVersionId: true,
      kind: true,
      cron: true,
      timezone: true,
      intervalMs: true,
      misfirePolicy: true,
      catchUpLimit: true,
      overlapPolicy: true,
      inputJson: true,
      urlFilesJson: true,
      nextRunAt: true,
      lastRunAt: true,
      createdAt: true,
    },
  })

  for (const s of schedules) {
    const computeNext = (from: Date) => {
      return computeNextRunAt({ ...s, nextRunAt: null }, from)
    }

    let next = computeNextRunAt(s, now)
    if (!next) continue

    // If not due, just ensure nextRunAt is set (for newly created schedules).
    if (next.getTime() > now.getTime()) {
      if (!s.nextRunAt) {
        await tx.schedule.update({ where: { id: s.id }, data: { nextRunAt: next } })
        touchedScheduleIds.add(String(s.id))
      }
      continue
    }

    // Misfire/overlap handling.
    const overlap = s.overlapPolicy ?? ScheduleOverlapPolicy.SKIP
    const misfire = s.misfirePolicy ?? ScheduleMisfirePolicy.FIRE_ONCE
    const catchUpLimit = typeof s.catchUpLimit === "number" ? s.catchUpLimit : null
    const hardCatchUpMax = 100

    let created = 0
    while (next && next.getTime() <= now.getTime()) {
      const isLate = now.getTime() - next.getTime() > 60_000 // >1m late counts as misfire

      if (misfire === ScheduleMisfirePolicy.SKIP && isLate) {
        // Skip all missed fires; jump to first future fire.
        next = computeNext(now)
        break
      }

      if (misfire === ScheduleMisfirePolicy.FIRE_ONCE && created > 0) {
        // After creating once, jump to first future fire.
        next = computeNext(now)
        break
      }

      if (misfire === ScheduleMisfirePolicy.CATCH_UP) {
        const limit = catchUpLimit ?? hardCatchUpMax
        if (created >= limit) {
          next = computeNext(now)
          break
        }
      }

      if (overlap === ScheduleOverlapPolicy.SKIP) {
        const active = await tx.jobRun.count({
          where: { scheduleId: s.id, status: { in: [JobRunStatus.QUEUED, JobRunStatus.RUNNING] } },
        })
        if (active > 0) {
          next = computeNext(next)
          continue
        }
      }

      const scheduledFor = next
      try {
        const pub = await allocatePublicId(tx, "job")
        // Merge schedule urlFiles into job initial input as system-managed `files[]`.
        const storedUrlFiles = parseStoredUrlFilesJson(s.urlFilesJson)
        const urlInputFiles = toUrlInputFiles(storedUrlFiles)
        const inputToWrite = mergeUrlInputFilesIntoInputJson({
          inputJson: typeof s.inputJson === "string" ? s.inputJson : "{}",
          urlInputFiles,
        })
        const createdJob = await tx.jobRun.create({
          data: {
            id: crypto.randomUUID(),
            publicId: pub.publicId,
            publicNumber: pub.publicNumber,
            status: JobRunStatus.QUEUED,
            workflowId: s.workflowId,
            pinnedWorkflowVersionId: s.pinnedWorkflowVersionId,
            scheduleId: s.id,
            scheduledFor,
            inputJson: inputToWrite,
            nextAttemptAt: null,
          },
          select: { id: true },
        })
        createdJobRunIds.push(String(createdJob.id))
        touchedScheduleIds.add(String(s.id))
        // Record schedule fire success (best-effort within this txn).
        await tx.schedule.update({
          where: { id: s.id },
          data: {
            lastFireAt: now,
            lastFireJobRunId: createdJob.id,
            lastFireErrorCode: null,
            lastFireErrorMetaJson: null,
          },
        })
      } catch (e) {
        // Ignore duplicate(scheduleId, scheduledFor).
        const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code?: unknown }).code) : null
        if (code !== "P2002") {
          const msg = e instanceof Error ? e.message : String(e)
          // Record schedule fire failure (best-effort) and continue.
          await tx.schedule.update({
            where: { id: s.id },
            data: {
              lastFireAt: now,
              lastFireJobRunId: null,
              lastFireErrorCode: "SCHEDULE_FIRE_FAILED",
              lastFireErrorMetaJson: JSON.stringify({ detail: msg }, null, 2),
            },
          })
          touchedScheduleIds.add(String(s.id))
          throw e
        }
      }
      created += 1
      await tx.schedule.update({
        where: { id: s.id },
        data: { lastRunAt: scheduledFor },
      })
      touchedScheduleIds.add(String(s.id))

      next = computeNext(scheduledFor)
    }

    await tx.schedule.update({
      where: { id: s.id },
      data: { nextRunAt: next },
    })
    touchedScheduleIds.add(String(s.id))
  }

  return {
    touchedScheduleIds: Array.from(touchedScheduleIds),
    createdJobRunIds,
  }
}

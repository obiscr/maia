import type { Locale } from "@/lib/shared/i18n/constants"

function toIntlLocale(locale: Locale): string {
  // Intl is picky about casing.
  if (locale.toLowerCase() === "zh-cn") return "zh-CN"
  return locale
}

type DateTimeParts = {
  year?: string
  month?: string
  day?: string
  hour?: string
  minute?: string
  second?: string
}

function formatYmdHmsFromParts(parts: DateTimeParts): string | null {
  const y = parts.year
  const mo = parts.month
  const d = parts.day
  const h = parts.hour
  const mi = parts.minute
  const s = parts.second
  if (!y || !mo || !d || !h || !mi || !s) return null
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`
}

/**
 * formatAbsoluteTime
 * Formats an ISO timestamp into a consistent "YYYY-MM-DD HH:mm:ss" string.
 *
 * - Uses opts.timeZone (IANA) when provided; otherwise uses runtime default timezone.
 * - Uses locale only for Intl parsing/numbering; output is kept consistent.
 */
export function formatAbsoluteTime(
  iso: string | null | undefined,
  opts: { locale?: Locale; timeZone?: string } = {},
): string {
  if (!iso) return "—"
  const d = new Date(String(iso))
  const ts = d.getTime()
  if (Number.isNaN(ts)) return String(iso)

  const locale = toIntlLocale(opts.locale ?? "en")
  const mk = (timeZone?: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })

  try {
    const dtf = mk(opts.timeZone)
    const parts = dtf.formatToParts(d)
    const out: DateTimeParts = {}
    for (const p of parts) {
      if (p.type === "year") out.year = p.value
      else if (p.type === "month") out.month = p.value
      else if (p.type === "day") out.day = p.value
      else if (p.type === "hour") out.hour = p.value
      else if (p.type === "minute") out.minute = p.value
      else if (p.type === "second") out.second = p.value
    }
    return formatYmdHmsFromParts(out) ?? dtf.format(d)
  } catch {
    try {
      // Fallback: ignore invalid timeZone and use runtime default.
      const dtf = mk(undefined)
      const parts = dtf.formatToParts(d)
      const out: DateTimeParts = {}
      for (const p of parts) {
        if (p.type === "year") out.year = p.value
        else if (p.type === "month") out.month = p.value
        else if (p.type === "day") out.day = p.value
        else if (p.type === "hour") out.hour = p.value
        else if (p.type === "minute") out.minute = p.value
        else if (p.type === "second") out.second = p.value
      }
      return formatYmdHmsFromParts(out) ?? dtf.format(d)
    } catch {
      return d.toISOString()
    }
  }
}

export function formatAbsoluteTimeTitle(
  iso: string | null | undefined,
  opts: { locale?: Locale; timeZone?: string } = {},
): string | undefined {
  if (!iso) return undefined
  return formatAbsoluteTime(iso, opts)
}

function formatInt(n: number, locale?: Locale): string {
  try {
    const nf = new Intl.NumberFormat(toIntlLocale(locale ?? "en"), { useGrouping: false, maximumFractionDigits: 0 })
    return nf.format(n)
  } catch {
    return String(n)
  }
}

function padInt(n: number, digits: number, locale?: Locale): string {
  try {
    const nf = new Intl.NumberFormat(toIntlLocale(locale ?? "en"), {
      useGrouping: false,
      minimumIntegerDigits: digits,
      maximumFractionDigits: 0,
    })
    return nf.format(n)
  } catch {
    return String(n).padStart(digits, "0")
  }
}

type RelativeTimeUnit = "second" | "minute" | "hour" | "day" | "week" | "month" | "year"

function pickUnit(deltaSeconds: number): { value: number; unit: RelativeTimeUnit } {
  const abs = Math.abs(deltaSeconds)
  if (abs < 60) return { value: Math.round(deltaSeconds), unit: "second" }
  const minutes = deltaSeconds / 60
  if (Math.abs(minutes) < 60) return { value: Math.round(minutes), unit: "minute" }
  const hours = minutes / 60
  if (Math.abs(hours) < 24) return { value: Math.round(hours), unit: "hour" }
  const days = hours / 24
  if (Math.abs(days) < 7) return { value: Math.round(days), unit: "day" }
  const weeks = days / 7
  if (Math.abs(weeks) < 4) return { value: Math.round(weeks), unit: "week" }
  const months = days / 30
  if (Math.abs(months) < 12) return { value: Math.round(months), unit: "month" }
  const years = days / 365
  return { value: Math.round(years), unit: "year" }
}

export function formatRelativeTimeFromNow(
  iso: string | null | undefined,
  opts: { now?: number; locale?: Locale } = {},
): string {
  if (!iso) return "—"
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return String(iso)
  const now = opts.now ?? Date.now()
  const deltaSeconds = Math.round((ts - now) / 1000)
  const { value, unit } = pickUnit(deltaSeconds)
  try {
    const rtf = new Intl.RelativeTimeFormat(toIntlLocale(opts.locale ?? "en"), { numeric: "auto" })
    return rtf.format(value, unit)
  } catch {
    // Fallback: short English
    const abs = Math.abs(deltaSeconds)
    if (abs < 60) return `${Math.round(abs)}s`
    const minutes = Math.round(abs / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.round(hours / 24)
    return `${days}d`
  }
}

export function formatDurationMs(ms: number | null, opts: { locale?: Locale } = {}) {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—"

  const totalMs = Math.floor(ms)
  if (totalMs < 1000) return `${formatInt(totalMs, opts.locale)}ms`

  const totalSec = Math.floor(totalMs / 1000)
  const msPart = totalMs % 1000

  const s = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const m = totalMin % 60
  const totalHr = Math.floor(totalMin / 60)
  const h = totalHr % 24
  const d = Math.floor(totalHr / 24)

  // Include milliseconds only when non-zero for cleaner display
  const msStr = msPart > 0 ? ` ${padInt(msPart, 3, opts.locale)}ms` : ""

  if (d > 0) {
    return `${formatInt(d, opts.locale)}d ${padInt(h, 2, opts.locale)}h ${padInt(m, 2, opts.locale)}m ${padInt(
      s,
      2,
      opts.locale,
    )}s${msStr}`
  }
  if (totalHr > 0) {
    return `${padInt(totalHr, 2, opts.locale)}h ${padInt(m, 2, opts.locale)}m ${padInt(s, 2, opts.locale)}s${msStr}`
  }
  if (totalMin > 0) {
    return `${padInt(totalMin, 2, opts.locale)}m ${padInt(s, 2, opts.locale)}s${msStr}`
  }
  return `${formatInt(totalSec, opts.locale)}s${msStr}`
}

/**
 * calcDurationMs
 * Computes a duration (ms) from ISO timestamps, with tolerant parsing.
 * - If startedAt is missing/invalid -> null
 * - If finishedAt is missing -> uses opts.now (default Date.now()) to support "running" durations
 */
export function calcDurationMs(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
  opts: { now?: number } = {},
): number | null {
  if (!startedAt) return null
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return null
  const end = finishedAt ? new Date(finishedAt).getTime() : (opts.now ?? Date.now())
  if (Number.isNaN(end)) return null
  const ms = end - start
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

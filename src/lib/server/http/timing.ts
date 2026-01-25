import "server-only"

import { performance } from "perf_hooks"

export type TimingMark = { name: string; ms: number }

export function createTiming(label: string) {
  const start = performance.now()
  const marks: TimingMark[] = []

  const mark = (name: string) => {
    marks.push({ name, ms: performance.now() - start })
  }

  const end = () => {
    const total = performance.now() - start
    return { label, total, marks }
  }

  return { mark, end }
}

export function toServerTiming(params: { total: number; marks: TimingMark[] }) {
  const parts: string[] = []
  parts.push(`total;dur=${params.total.toFixed(1)}`)
  for (const m of params.marks) {
    // Encode name for header safety; keep it readable.
    const safe = m.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) || "mark"
    parts.push(`${safe};dur=${m.ms.toFixed(1)}`)
  }
  return parts.join(", ")
}

export function logTiming(params: {
  label: string
  meta?: Record<string, unknown>
  total: number
  marks: TimingMark[]
}) {
  const metaStr = params.meta ? ` ${JSON.stringify(params.meta)}` : ""
  const breakdown = params.marks.map((m) => `${m.name}=${m.ms.toFixed(1)}ms`).join(" ")
  console.info(
    `[timing] ${params.label} total=${params.total.toFixed(1)}ms${metaStr}${breakdown ? ` ${breakdown}` : ""}`,
  )
}

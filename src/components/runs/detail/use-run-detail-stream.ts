"use client"

import * as React from "react"

import { useTopicStream } from "@/hooks/use-topic-stream"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { createEventIdGate, monotonicMerge } from "@/lib/shared/realtime/monotonic"
import { toCanonicalRunStatus } from "@/lib/shared/run-status"

type EventMeta = { ts?: string; level?: string; source?: string }

type StepLogLine = {
  id: number
  line: string
  stream: string
  attemptNo: number
  ts?: string
  level?: string
  code?: string
  meta?: unknown
  kind?: "log" | "status" | "step_error"
}

export type StreamEvent =
  | ({ type: "run_status"; runId: string; status: string } & EventMeta)
  | ({ type: "step_status"; runId: string; stepKey: string; status: string; attemptNo?: number } & EventMeta)
  | ({
      type: "step_error"
      runId: string
      stepKey: string
      attemptNo: number
      code: string
      meta?: unknown
    } & EventMeta)
  | {
      type: "log_line"
      runId: string
      stepKey: string
      attemptNo: number
      stream: "stdout" | "stderr"
      line: string
      ts?: string
      level?: string
      source?: string
    }
  | ({ type: "system"; runId: string; message: string } & EventMeta)

export function useRunDetailStream(params: { runId: string; maxLinesPerStep?: number }) {
  const runId = params.runId
  const maxLinesPerStep = params.maxLinesPerStep ?? 800

  const [logs, setLogs] = React.useState<Record<string, StepLogLine[]>>({})
  const [runStatus, setRunStatus] = React.useState<string | null>(null)
  const [stepStatusByKey, setStepStatusByKey] = React.useState<Record<string, { status: string; attemptNo?: number }>>(
    {},
  )
  const gateRef = React.useRef(createEventIdGate())
  const syntheticIdRef = React.useRef(-1)

  React.useEffect(() => {
    setLogs({})
    setRunStatus(null)
    setStepStatusByKey({})
    gateRef.current = createEventIdGate()
  }, [runId])

  const sortStepLines = React.useCallback((arr: StepLogLine[]) => {
    const pos = arr.filter((l) => l.id > 0).sort((a, b) => a.id - b.id)
    const neg = arr.filter((l) => l.id <= 0)
    return [...pos, ...neg]
  }, [])

  const { connected } = useTopicStream({
    topic: runId ? makeStreamTopic("run", runId) : null,
    enabled: !!runId,
    persistCursor: false,
    onMessage: (msg) => {
      const type = String(msg.type || "")
      const eventId = typeof msg.id === "number" && msg.id > 0 ? msg.id : null
      const data = msg.data && typeof msg.data === "object" ? (msg.data as Record<string, unknown>) : {}
      const getSyntheticId = () => {
        syntheticIdRef.current -= 1
        return syntheticIdRef.current
      }

      if (eventId && !gateRef.current.shouldApply(eventId)) return

      if (type === "step_error") {
        const stepKey = data.stepKey ? String(data.stepKey) : ""
        if (!stepKey) return
        const id = eventId ?? getSyntheticId()
        setLogs((prev) => {
          const nextLine: StepLogLine = {
            id,
            line: "",
            stream: "stderr",
            attemptNo: Number(data.attemptNo ?? 0),
            ts: typeof data.ts === "string" ? String(data.ts) : msg.ts,
            level: typeof data.level === "string" ? String(data.level) : "ERROR",
            code: typeof data.code === "string" ? String(data.code) : "UNKNOWN",
            meta: data.meta ?? null,
            kind: "step_error",
          }
          const arr = [...(prev[stepKey] ?? []), nextLine]
          const sorted = sortStepLines(arr)
          return { ...prev, [stepKey]: sorted.slice(-maxLinesPerStep) }
        })
      }

      if (type === "log_line") {
        const stepKey = data.stepKey ? String(data.stepKey) : ""
        if (!stepKey) return
        const id = eventId ?? getSyntheticId()
        const line = String(data.line ?? "")
        const stream = String(data.stream ?? "stdout")
        const kindRaw = typeof data.kind === "string" ? String(data.kind) : ""
        const kind: StepLogLine["kind"] = kindRaw === "status" ? "status" : "log"
        setLogs((prev) => {
          const nextLine: StepLogLine = {
            id,
            line,
            stream,
            attemptNo: Number(data.attemptNo ?? 0),
            ts: typeof data.ts === "string" ? String(data.ts) : msg.ts,
            level: typeof data.level === "string" ? String(data.level) : undefined,
            kind,
          }
          const arr = [...(prev[stepKey] ?? []), nextLine]
          const sorted = sortStepLines(arr)
          return { ...prev, [stepKey]: sorted.slice(-maxLinesPerStep) }
        })
      }

      if (type === "step_status") {
        const stepKey = data.stepKey ? String(data.stepKey) : ""
        if (!stepKey) return
        setStepStatusByKey((prev) => ({
          ...prev,
          [stepKey]: monotonicMerge(
            prev[stepKey] ?? { status: "" },
            { status: String(data.status ?? ""), attemptNo: data.attemptNo as number | undefined },
            {
              getStatus: (x) => String((x as { status?: unknown } | null)?.status ?? "").toUpperCase(),
              terminalStatuses: ["SUCCEEDED", "FAILED", "CANCELED", "SKIPPED"],
            },
          ),
        }))
      }

      if (type === "run_status") {
        const next = String(data.status ?? "")
        setRunStatus((prev) => {
          if (prev == null) return next
          const merged = monotonicMerge(
            { status: prev },
            { status: next },
            {
              getStatus: (x) => toCanonicalRunStatus(String((x as { status?: unknown } | null)?.status ?? "")),
              terminalStatuses: ["SUCCEEDED", "FAILED", "CANCELED"],
            },
          )
          return merged.status ?? prev
        })
      }
    },
  })

  const selectedLogs = React.useCallback(
    (stepKey: string | null) => {
      if (!stepKey) return []
      const arr = logs[stepKey] ?? []
      if (arr.length === 0) return arr
      const hasReal = arr.some((l) => l.kind === "log" || l.kind === "step_error")
      return hasReal ? arr.filter((l) => l.kind !== "status") : arr
    },
    [logs],
  )

  return {
    logs,
    setLogs,
    selectedLogs,
    connected,
    runStatus,
    stepStatusByKey,
  }
}

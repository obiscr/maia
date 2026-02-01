"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { useRunDetailStream } from "@/components/runs/detail/use-run-detail-stream"
import { toCanonicalRunStatus } from "@/lib/shared/run-status"
import { type WorkflowGraphStep } from "@/components/graph/workflow-graph-canvas"
import { apiFetchJson } from "@/lib/shared/http/api"

export type Run = {
  id: string
  workflowId: string
  workflowVersionId?: string | null
  workflowVersionNumber?: number | null
  workflowName: string
  workflowDescription?: string | null
  workflowSnap?: string | null
  reservedInitialInputKeys?: string[] | null
  status: string
  cancelRequestedAt?: string | null
  cancelRequestedReason?: string | null
  failureCode?: string | null
  failureMessage?: string | null
  failureMetaJson?: string | null
  failureAt?: string | null
  forkedFromRunId?: string | null
  forkKind?: string | null
  forkStepKey?: string | null
  jobRun?: {
    id: string
    scheduleId: string | null
    batchId: string | null
    scheduledFor: string | null
    createdAt: string
    schedule: {
      id: string
      name: string | null
      kind: string
      cron: string | null
      timezone: string | null
      intervalMs: number | null
    } | null
    batch: {
      id: string
      name: string | null
      status: string
    } | null
  } | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type RunStep = {
  stepKey: string
  name: string
  status: string
  depsJson: string
  startedAt: string | null
  finishedAt: string | null
}

type RunDetailResponse = { run: Run & { steps: RunStep[] } }

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function asRunDetailResponse(v: unknown): RunDetailResponse | null {
  if (!isRecord(v)) return null
  const run = v.run
  if (!isRecord(run)) return null
  return v as RunDetailResponse
}

function mergeStatus(dbStatus: string | null | undefined, streamStatus: string | null | undefined) {
  // Monotonic merge:
  // - Never allow a terminal DB status to be overwritten by a stale stream status.
  // - If stream has a terminal status and DB is non-terminal, prefer stream for responsiveness.
  const db = toCanonicalRunStatus(String(dbStatus ?? ""))
  const st = toCanonicalRunStatus(String(streamStatus ?? ""))
  const rank = (s: string) => {
    const up = toCanonicalRunStatus(s)
    if (up === "FAILED") return 100
    if (up === "CANCELED") return 90
    if (up === "SUCCEEDED") return 80
    if (up === "RUNNING") return 20
    if (up === "PENDING" || up === "BLOCKED" || up === "PENDING_INPUTS") return 10
    return 0
  }
  if (!st) return dbStatus ?? ""
  if (!db) return streamStatus ?? ""
  return rank(db) >= rank(st) ? (dbStatus ?? "") : (streamStatus ?? "")
}

export function useRunDetail(params: { runId: string }) {
  const runId = params.runId
  const queryClient = useQueryClient()

  const [selectedStepKey, setSelectedStepKey] = React.useState<string | null>(null)
  const [followProgress, setFollowProgress] = React.useState(true)
  const followRef = React.useRef(true)
  React.useEffect(() => {
    followRef.current = followProgress
  }, [followProgress])

  const lastStreamRunStatusRef = React.useRef<string | null>(null)
  const stream = useRunDetailStream({ runId, maxLinesPerStep: 800 })

  const runDetailQueryKey = React.useMemo(() => ["run", runId, "detail"] as const, [runId])

  const query = useQuery({
    queryKey: runDetailQueryKey,
    enabled: !!runId,
    queryFn: async ({ signal }) => {
      return await apiFetchJson<{ run: Run & { steps: RunStep[] } }>(`/api/runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
        signal,
      })
    },
  })

  const run = (query.data?.run ?? null) as (Run & { steps: RunStep[] }) | null
  const steps = (run?.steps ?? []) as RunStep[]
  const hasData = !!query.data
  const initialLoading = query.isLoading && !hasData
  const refreshing = query.isFetching && hasData
  const loading = initialLoading
  const error = (query.error ?? null) as unknown

  const refresh = React.useCallback(
    async (opts?: { preserveSelection?: boolean }) => {
      const res = await query.refetch()
      const nextRun = (res.data?.run ?? null) as (Run & { steps: RunStep[] }) | null
      const nextSteps = (nextRun?.steps ?? []) as RunStep[]
      const exists = new Set(nextSteps.map((s) => s.stepKey))
      const running = nextSteps.find((s) => toCanonicalRunStatus(s.status) === "RUNNING")?.stepKey ?? null
      const failed = nextSteps.find((s) => toCanonicalRunStatus(s.status) === "FAILED")?.stepKey ?? null
      const preferred = running ?? failed

      setSelectedStepKey((prev) => {
        const prevOk = prev && exists.has(prev)
        if (!prevOk) return preferred ?? nextSteps?.[0]?.stepKey ?? null
        if (opts?.preserveSelection) return prev
        if (followRef.current && preferred && preferred !== prev) return preferred
        return prev
      })
    },
    [query],
  )

  React.useEffect(() => {
    if (!run) return
    const nextSteps = run.steps ?? []
    const exists = new Set(nextSteps.map((s) => s.stepKey))
    const running = nextSteps.find((s) => toCanonicalRunStatus(s.status) === "RUNNING")?.stepKey ?? null
    const failed = nextSteps.find((s) => toCanonicalRunStatus(s.status) === "FAILED")?.stepKey ?? null
    const preferred = running ?? failed
    setSelectedStepKey((prev) => {
      const prevOk = prev && exists.has(prev)
      if (!prevOk) return preferred ?? nextSteps?.[0]?.stepKey ?? null
      if (followRef.current && preferred && preferred !== prev) return preferred
      return prev
    })
  }, [runId, run?.steps])

  // SSE only pushes status updates (no startedAt/finishedAt). If a run transitions to RUNNING
  // or a terminal state, refresh once so we can display accurate timing (duration) without
  // requiring the user to open the summary sheet.
  React.useEffect(() => {
    if (!run) return
    const streamCanon = toCanonicalRunStatus(String(stream.runStatus ?? ""))
    if (!streamCanon) return

    // Only act on transitions (prevents refresh spam on repeated events / reconnect snapshots).
    if (lastStreamRunStatusRef.current === streamCanon) return
    lastStreamRunStatusRef.current = streamCanon

    const isTerminal = streamCanon === "SUCCEEDED" || streamCanon === "FAILED" || streamCanon === "CANCELED"

    const shouldRefreshForTiming =
      (streamCanon === "RUNNING" && run.startedAt === null) ||
      (isTerminal && (run.startedAt === null || run.finishedAt === null))

    if (!shouldRefreshForTiming) return
    void refresh({ preserveSelection: true })
  }, [run, stream.runStatus, refresh])

  // Patch RQ cache with the latest stream statuses when data is present.
  // This makes the run/steps status available to any consumer of the query cache (not just this hook).
  React.useEffect(() => {
    if (!hasData) return
    const sRun = stream.runStatus ? String(stream.runStatus) : ""
    const sSteps = stream.stepStatusByKey ?? {}
    if (!sRun && Object.keys(sSteps).length === 0) return

    queryClient.setQueryData<RunDetailResponse>(runDetailQueryKey, (old: RunDetailResponse | undefined) => {
      const oldObj = asRunDetailResponse(old)
      const curRun = oldObj?.run ?? null
      if (!curRun) return old

      let changed = false

      const nextRunStatus = sRun ? mergeStatus(curRun.status, sRun) : curRun.status
      let nextRun = curRun
      if (nextRunStatus !== curRun.status) {
        nextRun = { ...nextRun, status: nextRunStatus }
        changed = true
      }

      const curSteps: RunStep[] = Array.isArray(curRun.steps) ? curRun.steps : []
      const stepKeys = Object.keys(sSteps)
      if (stepKeys.length > 0 && curSteps.length > 0) {
        let nextStepsArr: RunStep[] | null = null
        for (let i = 0; i < curSteps.length; i++) {
          const st = curSteps[i]
          const upd = sSteps[st.stepKey]
          if (!upd) continue
          const merged = mergeStatus(st.status, upd.status ? String(upd.status) : "")
          if (merged === st.status) continue
          if (!nextStepsArr) nextStepsArr = curSteps.slice()
          nextStepsArr[i] = { ...st, status: merged }
        }
        if (nextStepsArr) {
          nextRun = { ...nextRun, steps: nextStepsArr }
          changed = true
        }
      }

      if (!changed) return old
      return oldObj ? { ...oldObj, run: nextRun } : old
    })
  }, [hasData, queryClient, runDetailQueryKey, stream.runStatus, stream.stepStatusByKey])

  // IMPORTANT:
  // The SSE "status snapshot" can arrive before the initial DB fetch finishes.
  // If we try to apply SSE updates into state via setRun/setSteps before the DB data is loaded,
  // those updates are lost (prev is null/empty and we early-return). To avoid this race,
  // we merge SSE state into the fetched DB state in derived "effective" values.
  const effectiveRun = React.useMemo(() => {
    if (!run) return run
    const merged = mergeStatus(run.status, stream.runStatus ? String(stream.runStatus) : null)
    return merged === run.status ? run : { ...run, status: merged }
  }, [run, stream.runStatus])

  const effectiveSteps = React.useMemo(() => {
    if (!steps?.length) return steps
    const map = stream.stepStatusByKey
    const keys = Object.keys(map || {})
    if (keys.length === 0) return steps
    return steps.map((s) => {
      const upd = map[s.stepKey]
      if (!upd) return s
      const merged = mergeStatus(s.status, upd.status ? String(upd.status) : null)
      return merged === s.status ? s : { ...s, status: merged }
    })
  }, [steps, stream.stepStatusByKey])

  const selectedStep = React.useMemo(
    () => (selectedStepKey ? (effectiveSteps.find((s) => s.stepKey === selectedStepKey) ?? null) : null),
    [effectiveSteps, selectedStepKey],
  )

  const stepDurationMsByKey = React.useMemo(() => {
    const out: Record<string, number> = {}
    for (const s of effectiveSteps ?? []) {
      if (!s?.stepKey) continue
      if (!s.startedAt || !s.finishedAt) continue // only after completion
      const start = new Date(s.startedAt).getTime()
      const end = new Date(s.finishedAt).getTime()
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      const ms = end - start
      if (!Number.isFinite(ms) || ms < 0) continue
      out[s.stepKey] = ms
    }
    return out
  }, [effectiveSteps])

  const runDurationMs = React.useMemo(() => {
    const r = effectiveRun
    if (!r) return null

    const runStart = r.startedAt ? new Date(r.startedAt).getTime() : NaN
    const runEnd = r.finishedAt ? new Date(r.finishedAt).getTime() : NaN
    if (Number.isFinite(runStart)) {
      const end = Number.isFinite(runEnd) ? runEnd : Date.now()
      return end - runStart
    }

    // Fallback: infer from step timeline (wall-clock, not sum).
    let minStart = Infinity
    let maxEnd = -Infinity
    for (const s of effectiveSteps ?? []) {
      if (!s?.startedAt) continue
      const start = new Date(s.startedAt).getTime()
      if (!Number.isFinite(start)) continue
      const end = s.finishedAt ? new Date(s.finishedAt).getTime() : Date.now()
      if (!Number.isFinite(end)) continue
      minStart = Math.min(minStart, start)
      maxEnd = Math.max(maxEnd, end)
    }
    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd < minStart) return null
    return maxEnd - minStart
  }, [effectiveRun, effectiveSteps])

  const runCanonicalStatus = React.useMemo(
    () => toCanonicalRunStatus(effectiveRun?.status ?? ""),
    [effectiveRun?.status],
  )

  const showSummaryAction = React.useMemo(() => {
    // "Has run at least once" OR currently running: show summary/progress sheet entry.
    if (!run) return false
    if (runCanonicalStatus === "RUNNING") return true
    return run.startedAt !== null
  }, [run, runCanonicalStatus])

  const graphSteps: WorkflowGraphStep[] = React.useMemo(() => {
    return (effectiveSteps ?? []).map((s) => {
      let deps: string[] = []
      try {
        const parsed = JSON.parse(s.depsJson)
        if (Array.isArray(parsed)) deps = parsed.filter((x) => typeof x === "string")
      } catch {
        deps = []
      }
      return { stepKey: s.stepKey, name: s.name, deps }
    })
  }, [effectiveSteps])

  const stepStatusByKey = React.useMemo(() => {
    const m: Record<string, string> = {}
    const succeeded = new Set(
      (effectiveSteps ?? []).filter((s) => toCanonicalRunStatus(s.status) === "SUCCEEDED").map((s) => s.stepKey),
    )
    for (const s of effectiveSteps ?? []) {
      const base = toCanonicalRunStatus(s.status)
      if (base !== "PENDING") {
        m[s.stepKey] = s.status
        continue
      }
      let deps: string[] = []
      try {
        const parsed = JSON.parse(s.depsJson)
        if (Array.isArray(parsed)) deps = parsed.filter((x) => typeof x === "string")
      } catch {
        deps = []
      }
      const ready = deps.every((d) => succeeded.has(d))
      // Distinguish "queued" (deps satisfied but waiting for a slot) from "blocked" (waiting for deps).
      m[s.stepKey] = ready ? "PENDING" : "BLOCKED"
    }
    return m
  }, [effectiveSteps])

  const highlightStepKeys = React.useMemo(() => {
    const running = (effectiveSteps ?? [])
      .filter((s) => toCanonicalRunStatus(s.status) === "RUNNING")
      .map((s) => s.stepKey)
    if (running.length) return running
    const failed = (effectiveSteps ?? [])
      .filter((s) => toCanonicalRunStatus(s.status) === "FAILED")
      .map((s) => s.stepKey)
    if (failed.length) return failed
    return []
  }, [effectiveSteps])

  return {
    loading,
    refreshing,
    error,
    run,
    steps,
    stream,
    refresh,

    effectiveRun,
    effectiveSteps,

    selectedStepKey,
    setSelectedStepKey,
    selectedStep,

    followProgress,
    setFollowProgress,

    runDurationMs,
    stepDurationMsByKey,
    runCanonicalStatus,
    showSummaryAction,

    graphSteps,
    stepStatusByKey,
    highlightStepKeys,
  }
}

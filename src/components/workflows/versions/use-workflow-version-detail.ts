"use client"

import * as React from "react"

import { apiFetchJson } from "@/lib/shared/http/api"
import { isRecord } from "@/lib/shared/lang/is-record"
import { safeJsonObjectKeyCountOrNull } from "@/lib/shared/lang/safe-json"

export type WorkflowVersionSnapshotStep = {
  stepKey: string
  name: string
  scriptEsm: string
  timeoutMs: number
  deps: string[]
}

export type WorkflowVersionDetailPayload = {
  workflow: { id: string; name: string }
  version: {
    id: string
    version: number
    createdAt: string
    description: string | null
    snapshot: unknown
    snapshotJson: string
  }
}

function safeSteps(snap: unknown): WorkflowVersionSnapshotStep[] {
  if (!isRecord(snap)) return []
  const raw = snap.steps
  if (!Array.isArray(raw)) return []
  return raw
    .map((s) => {
      if (!isRecord(s)) return null
      const depsRaw = s.deps
      const deps = Array.isArray(depsRaw) ? depsRaw.filter((x): x is string => typeof x === "string") : []
      return {
        stepKey: typeof s.stepKey === "string" ? s.stepKey : "",
        name: typeof s.name === "string" ? s.name : "",
        scriptEsm: typeof s.scriptEsm === "string" ? s.scriptEsm : "",
        timeoutMs: typeof s.timeoutMs === "number" ? s.timeoutMs : 10 * 60 * 1000,
        deps,
      }
    })
    .filter((s): s is WorkflowVersionSnapshotStep => !!s && s.stepKey.length > 0)
}

export function useWorkflowVersionDetail(params: { workflowId: string; version: string }) {
  const [loading, setLoading] = React.useState(true)
  const [data, setData] = React.useState<WorkflowVersionDetailPayload | null>(null)
  const [error, setError] = React.useState<unknown>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const json = await apiFetchJson<WorkflowVersionDetailPayload>(
        `/api/workflows/${params.workflowId}/versions/${encodeURIComponent(params.version)}`,
        { cache: "no-store" },
      )
      setData(json)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [params.workflowId, params.version])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const snapshot = data?.version?.snapshot ?? null
  const depsHash = isRecord(snapshot) && typeof snapshot.depsHash === "string" ? String(snapshot.depsHash) : null
  const depsCount = safeJsonObjectKeyCountOrNull(isRecord(snapshot) ? snapshot.dependencies : null)
  const envCount = safeJsonObjectKeyCountOrNull(isRecord(snapshot) ? snapshot.envJson : null)
  const steps = React.useMemo(() => safeSteps(snapshot), [snapshot])

  return {
    loading,
    error,
    data,
    refresh,

    snapshot,
    depsHash,
    depsCount,
    envCount,
    steps,
  }
}

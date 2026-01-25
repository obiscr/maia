"use client"

import { apiFetchJson } from "@/lib/shared/http/api"

export type SaveWorkflowPayload = {
  name: string
  description?: string | null
  dependencies: string
  envJson: string
  inputSpec?: string | null
  outputsSpec?: string | null
  steps: Array<{
    stepKey: string
    name: string
    description?: string | null
    scriptEsm: string
    timeoutMs: number
    deps: string[]
  }>
}

export type UpdateWorkflowMetaPayload = {
  name?: string
  description?: string | null
}

export type DepsInstallLog = { id: string; level: string; createdAt: string; message: string }

export function useWorkflowEditorApi(params: { workflowId: string }) {
  const workflowId = params.workflowId

  return {
    saveWorkflow: (payload: SaveWorkflowPayload) => {
      // JSON.stringify omits keys with `undefined` values, so callers can "omit" inputSpec/outputsSpec
      // by passing undefined without needing extra mutation here.
      const body: SaveWorkflowPayload = payload
      return apiFetchJson(`/api/workflows/${workflowId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    },

    updateWorkflowMeta: (payload: UpdateWorkflowMetaPayload) => {
      const body: UpdateWorkflowMetaPayload = payload
      return apiFetchJson(`/api/workflows/${workflowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    },

    deleteWorkflow: () => apiFetchJson(`/api/workflows/${workflowId}`, { method: "DELETE" }),

    installDeps: () =>
      apiFetchJson<{ ok?: boolean; operationId?: string }>(`/api/workflows/${workflowId}/deps/install`, {
        method: "POST",
      }),

    fetchDepsInstallLogs: async (take?: number): Promise<{ logs: DepsInstallLog[] }> => {
      const json = await apiFetchJson<{
        logs?: Array<{ id?: unknown; level?: unknown; createdAt?: unknown; message?: unknown }>
      }>(
        `/api/workflows/${workflowId}/deps/logs${typeof take === "number" ? `?take=${encodeURIComponent(String(take))}` : ""}`,
        { method: "GET", cache: "no-store" },
      )
      const logsRaw = Array.isArray(json?.logs) ? json.logs : []
      const logs: DepsInstallLog[] = logsRaw.map((l, idx) => {
        const idRaw = l.id
        let id: string
        if (typeof idRaw === "string" && idRaw.trim()) id = idRaw
        else if (typeof idRaw === "number" && Number.isFinite(idRaw)) id = `log:${idRaw}`
        else id = `log:unknown:${idx}`
        return {
          id,
          level: typeof l.level === "string" ? l.level : String(l.level ?? "INFO"),
          createdAt: typeof l.createdAt === "string" ? l.createdAt : String(l.createdAt ?? ""),
          message: typeof l.message === "string" ? l.message : String(l.message ?? ""),
        }
      })
      return { logs }
    },

    createWorkflowVersion: (payload?: { description?: string | null }) =>
      apiFetchJson(`/api/workflows/${workflowId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      }),
  }
}

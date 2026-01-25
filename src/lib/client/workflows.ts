import { apiFetchJson } from "@/lib/shared/http/api"

export async function fetchWorkflowInputSpecRaw(args: {
  workflowId: string
  pinnedWorkflowVersionNumber?: number | null
}): Promise<string> {
  const workflowId = String(args.workflowId ?? "").trim()
  const pinned = typeof args.pinnedWorkflowVersionNumber === "number" ? args.pinnedWorkflowVersionNumber : null
  if (!workflowId) return ""

  if (pinned != null && Number.isFinite(pinned)) {
    const version = Math.floor(pinned)
    const j = await apiFetchJson<{ version?: { snapshot?: { inputSpec?: string | null } } }>(
      `/api/workflows/${encodeURIComponent(workflowId)}/versions/${version}`,
      { cache: "no-store" },
    )
    return typeof j?.version?.snapshot?.inputSpec === "string" ? String(j.version.snapshot.inputSpec).trim() : ""
  }

  const j = await apiFetchJson<{ workflow?: { inputSpec?: string | null } }>(
    `/api/workflows/${encodeURIComponent(workflowId)}`,
    { cache: "no-store" },
  )
  return typeof j?.workflow?.inputSpec === "string" ? String(j.workflow.inputSpec).trim() : ""
}

export async function fetchWorkflowStepCount(args: {
  workflowId: string
  pinnedWorkflowVersionNumber?: number | null
}): Promise<number> {
  const workflowId = String(args.workflowId ?? "").trim()
  const pinned = typeof args.pinnedWorkflowVersionNumber === "number" ? args.pinnedWorkflowVersionNumber : null
  if (!workflowId) return 0

  if (pinned != null && Number.isFinite(pinned)) {
    const version = Math.floor(pinned)
    const j = await apiFetchJson<{ version?: { snapshot?: { steps?: Array<unknown> | null } | null } }>(
      `/api/workflows/${encodeURIComponent(workflowId)}/versions/${version}`,
      { cache: "no-store" },
    )
    const steps = j?.version?.snapshot?.steps
    return Array.isArray(steps) ? steps.length : 0
  }

  const j = await apiFetchJson<{ workflow?: { steps?: Array<unknown> | null } }>(
    `/api/workflows/${encodeURIComponent(workflowId)}`,
    { cache: "no-store" },
  )
  const steps = j?.workflow?.steps
  return Array.isArray(steps) ? steps.length : 0
}

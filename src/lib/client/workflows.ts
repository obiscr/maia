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

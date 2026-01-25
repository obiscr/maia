import { apiFetchJson } from "@/lib/shared/http/api"
import { workflowExportV1ToCreateWorkflowPayload, type WorkflowExportV1 } from "@/lib/shared/workflow-import-export"

export type WorkflowTemplateMeta = {
  id: string
  fileName: string
  name: string
  description: string | null
  stepCount: number
  depsCount: number
}

export async function fetchWorkflowTemplates(): Promise<WorkflowTemplateMeta[]> {
  const json = await apiFetchJson<{ templates: WorkflowTemplateMeta[] }>("/api/templates")
  return Array.isArray(json.templates) ? json.templates : []
}

export async function importWorkflowTemplate(
  templateId: string,
): Promise<{ workflowId: string; needsDepsInstall: boolean }> {
  const t = await apiFetchJson<{ template: WorkflowExportV1 }>(`/api/templates/${encodeURIComponent(templateId)}`)
  const exp = t.template
  const depsCount = Object.keys(exp.data.dependencies ?? {}).length
  const needsDepsInstall = depsCount > 0
  const payload = workflowExportV1ToCreateWorkflowPayload(exp)
  const created = await apiFetchJson<{ workflow?: { id: string } }>("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const workflowId = String(created.workflow?.id ?? "")
  if (!workflowId) throw new Error("Missing workflow id")
  return { workflowId, needsDepsInstall }
}

import type { WorkflowInputSpec } from "@/lib/shared/maia/input-spec"

export type WorkflowFileInputKey = "urlFiles" | "uploads"

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim() : ""
}

export function workflowFileInputUi(
  spec: WorkflowInputSpec | null | undefined,
  key: WorkflowFileInputKey,
  fallbackTitle: string,
): { title: string; description: string } {
  const titleRaw = norm(spec?.fileInputs?.[key]?.title)
  const descRaw = norm(spec?.fileInputs?.[key]?.description)
  return {
    title: titleRaw || fallbackTitle,
    description: descRaw,
  }
}

export function joinHintParts(parts: Array<string | null | undefined>, sep = " · "): string {
  const clean = parts.map((p) => norm(p)).filter(Boolean)
  return clean.join(sep)
}

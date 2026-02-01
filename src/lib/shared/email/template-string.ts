function toTemplateVarString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : ""
  if (typeof v === "boolean") return v ? "true" : "false"
  return String(v)
}

/**
 * Very small template renderer:
 * - Replaces `{{var}}` with the corresponding stringified value.
 * - Unknown vars render as empty string.
 * - No conditionals/loops/partials (intentionally).
 */
export function renderTemplateString(template: string, vars: Record<string, unknown>): string {
  const s = String(template ?? "")
  return s.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key: string) => {
    if (!key) return ""
    return toTemplateVarString(vars[key])
  })
}

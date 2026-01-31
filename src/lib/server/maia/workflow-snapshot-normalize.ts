import "server-only"

import { workflowSnapshotSchema, type WorkflowSnapshot } from "@/lib/server/maia/snapshot"

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function deepSortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deepSortKeys)
  if (!isPlainObject(v)) return v
  const entries = Object.entries(v)
    .map(([k, val]) => [k, deepSortKeys(val)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(entries)
}

function pruneEmptyObjects(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(pruneEmptyObjects)
  if (!isPlainObject(v)) return v
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) {
    const next = pruneEmptyObjects(val)
    if (isPlainObject(next) && Object.keys(next).length === 0) continue
    out[k] = next
  }
  return out
}

type RetryPolicy = WorkflowSnapshot["steps"][number]["retryPolicy"]

const retryPolicySchema = workflowSnapshotSchema.shape.steps.element.shape.retryPolicy

export function normalizeRetryPolicyObject(retryPolicy: unknown): RetryPolicy | undefined {
  if (!isPlainObject(retryPolicy)) return undefined
  const sorted = deepSortKeys(retryPolicy)
  const pruned = pruneEmptyObjects(sorted)
  if (!isPlainObject(pruned) || Object.keys(pruned).length === 0) return undefined
  const parsed = retryPolicySchema.safeParse(pruned)
  return parsed.success ? (parsed.data as RetryPolicy) : undefined
}

export function normalizeRetryPolicyJson(raw: unknown): RetryPolicy | undefined {
  const txt = typeof raw === "string" ? raw.trim() : ""
  if (!txt) return undefined
  try {
    const parsed: unknown = JSON.parse(txt)
    return normalizeRetryPolicyObject(parsed)
  } catch {
    return undefined
  }
}

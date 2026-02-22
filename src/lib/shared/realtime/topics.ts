export type StreamTopic = `${string}:${string}`

export const KNOWN_STREAM_TOPIC_KINDS = [
  "run",
  "runs",
  "job",
  "jobs",
  "batch",
  "batches",
  "schedule",
  "schedules",
  "workflowDeps",
  "operation",
  "operations",
] as const

export type StreamTopicKind = (typeof KNOWN_STREAM_TOPIC_KINDS)[number]

export function isKnownStreamTopicKind(kind: string): kind is StreamTopicKind {
  return (KNOWN_STREAM_TOPIC_KINDS as readonly string[]).includes(String(kind || ""))
}

// Only these kinds support list topics (`kind:list_admin` / `kind:list_<userPublicId>`).
export const LIST_STREAM_TOPIC_KINDS = ["runs", "jobs", "batches", "schedules", "operations"] as const
export type ListStreamTopicKind = (typeof LIST_STREAM_TOPIC_KINDS)[number]

export function isListStreamTopicKind(kind: string): kind is ListStreamTopicKind {
  return (LIST_STREAM_TOPIC_KINDS as readonly string[]).includes(String(kind || ""))
}

export function makeStreamTopic(kind: string, id: string): StreamTopic {
  const k = String(kind || "").trim()
  const v = String(id || "").trim()
  if (!k) throw new Error("stream topic kind required")
  if (!v) throw new Error("stream topic id required")
  if (k.includes(":")) throw new Error("stream topic kind must not include ':'")
  if (v.includes(":")) throw new Error("stream topic id must not include ':'")
  return `${k}:${v}` as StreamTopic
}

export function makeUserListStreamTopic(kind: ListStreamTopicKind, userPublicId: string): StreamTopic {
  const pid = String(userPublicId || "").trim()
  if (!pid) throw new Error("user publicId required")
  return makeStreamTopic(kind, `list_${pid}`)
}

export function makeAdminListStreamTopic(kind: ListStreamTopicKind): StreamTopic {
  return makeStreamTopic(kind, "list_admin")
}

export function parseListStreamTopicId(
  id: string,
): { scope: "admin" } | { scope: "user"; userPublicId: string } | null {
  const s = String(id || "").trim()
  if (!s) return null
  if (s === "list_admin") return { scope: "admin" }
  if (s.startsWith("list_") && s.length > "list_".length)
    return { scope: "user", userPublicId: s.slice("list_".length) }
  return null
}

export function parseStreamTopic(raw: string): { topic: StreamTopic; kind: string; id: string } | null {
  const s = String(raw || "").trim()
  const idx = s.indexOf(":")
  if (idx <= 0) return null
  const kind = s.slice(0, idx).trim()
  const id = s.slice(idx + 1).trim()
  if (!kind || !id) return null
  if (kind.includes(":") || id.includes(":")) return null
  return { topic: `${kind}:${id}` as StreamTopic, kind, id }
}

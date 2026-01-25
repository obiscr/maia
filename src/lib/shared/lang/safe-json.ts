export function safeJsonParse(raw: string | null | undefined): unknown | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function safeJsonParseObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== "object" || Array.isArray(v)) return null
    return v as Record<string, unknown>
  } catch {
    return null
  }
}

export function safeJsonParseStringArray(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x) => typeof x === "string")
  } catch {
    return []
  }
}

export function safeJsonParseStringNumberRecord(raw: unknown): Record<string, string | number> | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const out: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number") out[k] = v
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

export function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return null
  }
}

export function safeJsonStringifyOrNullLiteral(value: unknown): string {
  return safeJsonStringify(value) ?? JSON.stringify(null)
}

export function safeJsonStringifyPrettyOrEmpty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ""
  }
}

export function safeJsonObjectKeyCountOr0(raw: unknown): number {
  if (typeof raw !== "string") return 0
  const s = raw.trim()
  if (!s) return 0
  try {
    const obj = JSON.parse(s)
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return 0
    return Object.keys(obj as Record<string, unknown>).length
  } catch {
    return 0
  }
}

export function safeJsonObjectKeyCountOrNull(raw: unknown): number | null {
  if (typeof raw !== "string") return null
  const s = raw.trim()
  if (!s) return null
  try {
    const obj = JSON.parse(s)
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null
    return Object.keys(obj as Record<string, unknown>).length
  } catch {
    return null
  }
}

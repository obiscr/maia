export function toMetaRecord<T>(meta: T | null | undefined): Record<string, unknown> | null {
  if (!meta) return null
  // Keep the runtime contract minimal: meta must be object-like.
  if (typeof meta !== "object" || Array.isArray(meta)) return null
  return meta as unknown as Record<string, unknown>
}

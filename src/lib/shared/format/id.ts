export type ShortIdFormatOptions = {
  /** Number of leading characters to keep. */
  head?: number
  /** Number of trailing characters to keep. */
  tail?: number
  /** Only shorten when length is greater than this value. */
  minLength?: number
  /** Ellipsis string to insert between head and tail. Defaults to "…". */
  ellipsis?: string
  /** Placeholder when id is null/empty. Defaults to "—". */
  emptyPlaceholder?: string
}

export function looksLikePublicId(id: string): boolean {
  const t = typeof id === "string" ? id.trim() : String(id ?? "").trim()
  if (!t) return false
  // Per the "professional" public id rollout:
  // - lowercase in URLs
  // - prefix + "-" + positive integer (no zero padding)
  // Examples: wf-1, run-12, job-380, sch-9, bat-3, op-92
  return /^[a-z]{2,4}-[1-9][0-9]*$/.test(t.toLowerCase())
}

/**
 * formatPublicIdForDisplay
 * Uppercases public IDs for UI display (URL stays lowercase).
 * Examples: `job-92` -> `JOB-92`
 */
export function formatPublicIdForDisplay(
  id: string | null | undefined,
  opts: { emptyPlaceholder?: string } = {},
): string {
  const raw = typeof id === "string" ? id : id == null ? "" : String(id)
  const t = raw.trim()
  const emptyPlaceholder = opts.emptyPlaceholder ?? "—"
  if (!t) return emptyPlaceholder
  return looksLikePublicId(t) ? t.toUpperCase() : t
}

/**
 * formatShortId
 * Formats long IDs like UUIDs into a shorter form: `aaaaaaaa…bbbbbb`.
 * Default format matches the app breadcrumb fallback: 8 leading + 6 trailing.
 */
export function formatShortId(id: string | null | undefined, opts: ShortIdFormatOptions = {}): string {
  const raw = typeof id === "string" ? id : id == null ? "" : String(id)
  const t = raw.trim()
  const emptyPlaceholder = opts.emptyPlaceholder ?? "—"
  if (!t) return emptyPlaceholder
  if (looksLikePublicId(t)) return t.toUpperCase()

  const head = typeof opts.head === "number" ? Math.max(0, Math.floor(opts.head)) : 8
  const tail = typeof opts.tail === "number" ? Math.max(0, Math.floor(opts.tail)) : 6
  const minLength = typeof opts.minLength === "number" ? Math.max(0, Math.floor(opts.minLength)) : 20
  const ellipsis = typeof opts.ellipsis === "string" && opts.ellipsis.length ? opts.ellipsis : "…"

  if (t.length <= minLength) return t
  if (head <= 0 && tail <= 0) return t
  if (tail <= 0) return `${t.slice(0, Math.max(1, head))}${ellipsis}`
  if (head <= 0) return `${ellipsis}${t.slice(-Math.max(1, tail))}`
  if (head + tail >= t.length) return t

  return `${t.slice(0, head)}${ellipsis}${t.slice(-tail)}`
}

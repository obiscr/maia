/**
 * Small, dependency-free helpers for client-side SSE consumption:
 * - idempotent de-dupe by monotonically increasing SSE id
 * - monotonic merge (newer version wins; terminal state never regresses)
 *
 * JS on purpose: can be imported by Node verification scripts without TS runtime.
 */

export function parseIsoMs(v) {
  if (v == null) return null
  if (typeof v === "number" && Number.isFinite(v)) return v
  const s = String(v || "").trim()
  if (!s) return null
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? ms : null
}

export function createEventIdGate(initialId) {
  let last = Number.isFinite(initialId) && initialId > 0 ? Math.floor(initialId) : 0
  return {
    get lastId() {
      return last
    },
    /**
     * Returns true if this event id should be applied.
     * - id <= 0 or missing => treated as non-idempotent (always apply)
     * - id <= lastId => drop
     * - id > lastId => accept and advance lastId
     */
    shouldApply(id) {
      const n = typeof id === "number" ? id : Number(id)
      const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
      if (!next) return true
      if (next <= last) return false
      last = next
      return true
    },
  }
}

/**
 * Shallow monotonic merge:
 * - If incoming is older by version, ignore.
 * - If previous is terminal but incoming isn't, ignore (prevents regression).
 * - Otherwise shallow-merge `{...prev, ...patch}`.
 */
export function monotonicMerge(prev, patch, opts) {
  if (prev == null) return prev
  if (patch == null || typeof patch !== "object") return prev

  const getVersion =
    typeof opts?.getVersion === "function"
      ? opts.getVersion
      : (x) => parseIsoMs(x?.[opts?.versionKey || "updatedAt"] ?? x?.ts ?? null)

  const pv = getVersion(prev)
  const nv = getVersion(patch)
  if (pv != null && nv != null && nv < pv) return prev

  const getStatus = typeof opts?.getStatus === "function" ? opts.getStatus : null
  const terminal = Array.isArray(opts?.terminalStatuses) ? opts.terminalStatuses.map((s) => String(s)) : []
  if (getStatus && terminal.length) {
    const prevS = String(getStatus(prev) ?? "")
    const nextS = String(getStatus(patch) ?? "")
    const tset = new Set(terminal)
    const prevT = tset.has(prevS)
    const nextT = tset.has(nextS)
    if (prevT && !nextT) return prev
  }

  return { ...prev, ...patch }
}

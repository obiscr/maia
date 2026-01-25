import type { DisplayError, ErrorEnvelope } from "@/lib/shared/error-display/types"

function flattenChain(wrapper: ErrorEnvelope): ErrorEnvelope[] {
  const out: ErrorEnvelope[] = []
  const stack: ErrorEnvelope[] = [wrapper]
  while (stack.length) {
    const cur = stack.shift()!
    out.push(cur)
    const causes = Array.isArray(cur.causes) ? cur.causes : []
    // causes are wrapper → root; keep order
    for (const c of causes) stack.push(c)
  }
  return out
}

/**
 * Pick the best error to show as the primary code.
 *
 * Default rule: prefer the most specific root cause (the last in the chain).
 * Callers can still render wrapper/message/meta in a tooltip/details panel.
 */
export function resolveDisplayError(wrapper: ErrorEnvelope | null | undefined): DisplayError | null {
  if (!wrapper) return null
  const w: ErrorEnvelope = {
    code: String(wrapper.code ?? "UNKNOWN"),
    message: wrapper.message ?? null,
    layer: wrapper.layer ?? null,
    meta: wrapper.meta ?? null,
    causes: wrapper.causes ?? null,
  }
  const chain = flattenChain(w)
  const display = chain.length ? chain[chain.length - 1] : w
  return { display, wrapper: w, chain }
}

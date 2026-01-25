import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

export type BatchFanoutKind = "auto"

export function expandSeedToItems(params: { kind?: BatchFanoutKind; seed: unknown; maxItems: number }): {
  kind: BatchFanoutKind
  items: unknown[]
  truncated: boolean
} {
  const kind: BatchFanoutKind = params.kind ?? "auto"
  const max = Math.max(1, Math.floor(params.maxItems || 1))

  let items: unknown[]
  if (kind === "auto") {
    if (Array.isArray(params.seed)) items = params.seed
    else if (isPlainObject(params.seed) && Array.isArray(params.seed.items)) items = params.seed.items
    else items = [params.seed]
  } else {
    items = [params.seed]
  }

  if (items.length <= max) return { kind, items, truncated: false }
  return { kind, items: items.slice(0, max), truncated: true }
}

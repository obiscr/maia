import type { PlainObject } from "@/lib/shared/types/plain-object"

/**
 * Loose object check:
 * - `typeof x === "object"`
 * - non-null
 * - not an Array
 *
 * This is intentionally *not* a "plain object" check (it allows class instances like `Error`).
 */
export function isRecord(x: unknown): x is PlainObject {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}

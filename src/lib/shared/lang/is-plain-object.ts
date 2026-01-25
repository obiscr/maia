import type { PlainObject } from "@/lib/shared/types/plain-object"

/**
 * Strict "plain object" check: only objects whose prototype is `Object.prototype` or `null`.
 * This excludes arrays, dates, errors, class instances, etc.
 */
export function isPlainObject(x: unknown): x is PlainObject {
  if (!x || typeof x !== "object") return false
  if (Array.isArray(x)) return false
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

/**
 * A string-keyed object with unknown values.
 *
 * Notes:
 * - This is a *shape* type, not a runtime guarantee.
 * - Use `isRecord()` (loose) or `isPlainObject()` (strict) for runtime checks.
 */
export type PlainObject = Record<string, unknown>

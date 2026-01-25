// Standard list row type used across list pages.
// We represent skeleton rows as `null` so list renderers can be fully generic.
export type ListRow<T> = T | null

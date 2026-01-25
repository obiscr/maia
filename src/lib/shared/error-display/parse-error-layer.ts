import type { ErrorLayer } from "./types"

const ERROR_LAYERS = new Set<ErrorLayer>([
  "step",
  "attempt",
  "run",
  "job",
  "workflow",
  "schedule",
  "batch",
  "operation",
  "api",
  "system",
])

export function parseErrorLayer(x: unknown): ErrorLayer | null {
  if (typeof x !== "string") return null
  return ERROR_LAYERS.has(x as ErrorLayer) ? (x as ErrorLayer) : null
}

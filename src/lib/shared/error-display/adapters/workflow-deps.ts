import { resolveDisplayError } from "@/lib/shared/error-display/resolve-display-error"
import type { ErrorEnvelope } from "@/lib/shared/error-display/types"
import { toMetaRecord } from "@/lib/shared/error-display/to-meta-record"
import { safeJsonParseObject } from "@/lib/shared/lang/safe-json"

export type WorkflowDepsErrorMeta = {
  depsHash?: string | null
  cwd?: string | null
  command?: string | null
  args?: string[] | null

  exitCode?: number | null
  signal?: string | null

  spawnErrorCode?: string | null
  spawnErrorMessage?: string | null

  // Runner/container execution failures (e.g. docker create failed...)
  runnerError?: string | null

  detail?: string | null
}

function getString(obj: Record<string, unknown> | null, key: string): string | null {
  const v = obj?.[key]
  return typeof v === "string" && v.trim() ? String(v) : null
}

function getNumber(obj: Record<string, unknown> | null, key: string): number | null {
  const v = obj?.[key]
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function getStringArray(obj: Record<string, unknown> | null, key: string): string[] | null {
  const v = obj?.[key]
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const it of v) {
    if (typeof it === "string") out.push(it)
  }
  return out.length ? out : null
}

export function parseWorkflowDepsErrorMeta(metaJson: string | null | undefined): WorkflowDepsErrorMeta | null {
  const obj = safeJsonParseObject(metaJson)
  if (!obj) return null
  return {
    depsHash: getString(obj, "depsHash"),
    cwd: getString(obj, "cwd"),
    command: getString(obj, "command"),
    args: getStringArray(obj, "args"),
    exitCode: getNumber(obj, "exitCode"),
    signal: getString(obj, "signal"),
    spawnErrorCode: getString(obj, "spawnErrorCode"),
    spawnErrorMessage: getString(obj, "spawnErrorMessage"),
    runnerError: getString(obj, "runnerError"),
    detail: getString(obj, "detail"),
  }
}

export type WorkflowDepsDisplayError = {
  displayCode: string | null
  wrapperCode: string | null
  wrapperMessage: string | null
  meta: WorkflowDepsErrorMeta | null
}

export function buildWorkflowDepsErrorEnvelope(input: {
  depsErrorCode?: string | null | undefined
  depsErrorMessage?: string | null | undefined
  depsErrorMetaJson?: string | null | undefined
}): ErrorEnvelope | null {
  const wrapperCode = input.depsErrorCode ? String(input.depsErrorCode) : null
  const wrapperMessage = input.depsErrorMessage ? String(input.depsErrorMessage) : null
  const meta = parseWorkflowDepsErrorMeta(input.depsErrorMetaJson ?? null)

  function inferRunnerCause(): ErrorEnvelope | null {
    const msg = meta?.runnerError ? String(meta.runnerError) : ""
    if (!msg.trim()) return null
    const trimmed = msg.trim()
    if (/^docker create failed:/i.test(trimmed)) {
      return { code: "DOCKER_CREATE_FAILED", message: trimmed, layer: "system", meta: toMetaRecord(meta) }
    }
    if (/^docker start failed:/i.test(trimmed)) {
      return { code: "DOCKER_START_FAILED", message: trimmed, layer: "system", meta: toMetaRecord(meta) }
    }
    return { code: "RUNNER_EXEC_FAILED", message: trimmed, layer: "system", meta: toMetaRecord(meta) }
  }

  const cause: ErrorEnvelope | null = (() => {
    const runnerCause = inferRunnerCause()
    if (runnerCause) return runnerCause
    if (meta?.spawnErrorCode) {
      return {
        code: "PNPM_SPAWN_FAILED",
        message: meta.spawnErrorMessage ?? null,
        layer: "system",
        meta: toMetaRecord(meta),
      }
    }
    if (typeof meta?.exitCode === "number") {
      return {
        code: "PNPM_INSTALL_EXIT_NONZERO",
        message: `exitCode=${String(meta.exitCode)}`,
        layer: "workflow",
        meta: toMetaRecord(meta),
      }
    }
    if (meta?.signal) {
      return {
        code: "PNPM_INSTALL_SIGNAL",
        message: `signal=${String(meta.signal)}`,
        layer: "workflow",
        meta: toMetaRecord(meta),
      }
    }
    // Fallback: if we have a detail string, surface it as a root cause.
    if (meta?.detail) {
      return { code: "DEPS_INSTALL_DETAIL", message: String(meta.detail), layer: "workflow", meta: toMetaRecord(meta) }
    }
    return null
  })()

  return wrapperCode || wrapperMessage
    ? {
        code: wrapperCode ?? "UNKNOWN",
        message: wrapperMessage ?? null,
        layer: "workflow",
        meta: toMetaRecord(meta),
        causes: cause ? [cause] : null,
      }
    : null
}

/**
 * Workflow deps (pnpm install) error adapter:
 * - Wrapper: Workflow.depsErrorCode + depsErrorMessage (often DEPS_INSTALL_FAILED)
 * - Root cause: derived from structured meta when available
 */
export function resolveWorkflowDepsDisplayError(input: {
  depsErrorCode?: string | null | undefined
  depsErrorMessage?: string | null | undefined
  depsErrorMetaJson?: string | null | undefined
}): WorkflowDepsDisplayError {
  const wrapperCode = input.depsErrorCode ? String(input.depsErrorCode) : null
  const wrapperMessage = input.depsErrorMessage ? String(input.depsErrorMessage) : null
  const meta = parseWorkflowDepsErrorMeta(input.depsErrorMetaJson ?? null)

  const resolved = resolveDisplayError(buildWorkflowDepsErrorEnvelope(input))
  const displayCode = resolved?.display?.code ? String(resolved.display.code) : wrapperCode
  return { displayCode: displayCode ?? null, wrapperCode, wrapperMessage, meta }
}

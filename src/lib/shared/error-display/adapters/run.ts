import { resolveDisplayError } from "@/lib/shared/error-display/resolve-display-error"
import type { ErrorEnvelope } from "@/lib/shared/error-display/types"
import { toMetaRecord } from "@/lib/shared/error-display/to-meta-record"
import { safeJsonParseObject } from "@/lib/shared/lang/safe-json"

export type RunFailureMeta = {
  stepKey?: string | null
  attemptNo?: number | null
  stepErrorCode?: string | null
  stepErrorMessage?: string | null
  stepErrorMetaJson?: string | null
  timeoutMs?: number | null
  signal?: string | null
  exitCode?: number | null
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

export function parseRunFailureMeta(metaJson: string | null | undefined): RunFailureMeta | null {
  const obj = safeJsonParseObject(metaJson)
  if (!obj) return null
  return {
    stepKey: getString(obj, "stepKey"),
    attemptNo: getNumber(obj, "attemptNo"),
    stepErrorCode: getString(obj, "stepErrorCode"),
    stepErrorMessage: getString(obj, "stepErrorMessage"),
    stepErrorMetaJson: getString(obj, "stepErrorMetaJson"),
    timeoutMs: getNumber(obj, "timeoutMs"),
    signal: getString(obj, "signal"),
    exitCode: getNumber(obj, "exitCode"),
  }
}

export type RunDisplayError = {
  displayCode: string | null
  wrapperCode: string | null
  wrapperMessage: string | null
  meta: RunFailureMeta | null
}

export function buildRunErrorEnvelope(input: {
  failureCode?: string | null | undefined
  failureMessage?: string | null | undefined
  failureMetaJson?: string | null | undefined
}): ErrorEnvelope | null {
  const wrapperCode = input.failureCode ? String(input.failureCode) : null
  const wrapperMessage = input.failureMessage ? String(input.failureMessage) : null
  const meta = parseRunFailureMeta(input.failureMetaJson ?? null)

  return wrapperCode || wrapperMessage
    ? {
        code: wrapperCode ?? "UNKNOWN",
        message: wrapperMessage ?? null,
        layer: "run",
        meta: toMetaRecord(meta),
        causes:
          meta?.stepErrorCode && meta.stepErrorCode.trim()
            ? [
                {
                  code: String(meta.stepErrorCode),
                  message: meta.stepErrorMessage ?? null,
                  layer: "step",
                  meta: toMetaRecord(meta),
                },
              ]
            : null,
      }
    : null
}

/**
 * Run error adapter:
 * - Wrapper: Run.failureCode + failureMessage (often STEP_FAILED)
 * - Root cause: meta.stepErrorCode (e.g. STEP_TIMEOUT, OUTPUT_INVALID)
 */
export function resolveRunDisplayError(input: {
  failureCode?: string | null | undefined
  failureMessage?: string | null | undefined
  failureMetaJson?: string | null | undefined
}): RunDisplayError {
  const wrapperCode = input.failureCode ? String(input.failureCode) : null
  const wrapperMessage = input.failureMessage ? String(input.failureMessage) : null
  const meta = parseRunFailureMeta(input.failureMetaJson ?? null)

  const resolved = resolveDisplayError(buildRunErrorEnvelope(input))
  const displayCode = resolved?.display?.code ? String(resolved.display.code) : wrapperCode
  return { displayCode: displayCode ?? null, wrapperCode, wrapperMessage, meta }
}

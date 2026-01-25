import { resolveDisplayError } from "@/lib/shared/error-display/resolve-display-error"
import type { ErrorEnvelope } from "@/lib/shared/error-display/types"
import { toMetaRecord } from "@/lib/shared/error-display/to-meta-record"
import { safeJsonParseObject } from "@/lib/shared/lang/safe-json"

export type JobErrorMeta = {
  runId?: string | null
  stepKey?: string | null
  attemptNo?: number | null
  stepErrorCode?: string | null
  stepErrorMessage?: string | null
  stepErrorMetaJson?: string | null
  timeoutMs?: number | null
  signal?: string | null
  exitCode?: number | null
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

export function parseJobErrorMeta(metaJson: string | null | undefined): JobErrorMeta | null {
  const obj = safeJsonParseObject(metaJson)
  if (!obj) return null
  return {
    runId: getString(obj, "runId"),
    stepKey: getString(obj, "stepKey"),
    attemptNo: getNumber(obj, "attemptNo"),
    stepErrorCode: getString(obj, "stepErrorCode"),
    stepErrorMessage: getString(obj, "stepErrorMessage"),
    stepErrorMetaJson: getString(obj, "stepErrorMetaJson"),
    timeoutMs: getNumber(obj, "timeoutMs"),
    signal: getString(obj, "signal"),
    exitCode: getNumber(obj, "exitCode"),
    detail: getString(obj, "detail"),
  }
}

export type JobDisplayError = {
  displayCode: string | null
  wrapperCode: string | null
  wrapperMessage: string | null
  meta: JobErrorMeta | null
}

export function buildJobErrorEnvelope(input: {
  errorCode?: string | null | undefined
  errorMessage?: string | null | undefined
  errorMetaJson?: string | null | undefined
}): ErrorEnvelope | null {
  const wrapperCode = input.errorCode ? String(input.errorCode) : null
  const wrapperMessage = input.errorMessage ? String(input.errorMessage) : null
  const meta = parseJobErrorMeta(input.errorMetaJson ?? null)

  return wrapperCode || wrapperMessage
    ? {
        code: wrapperCode ?? "UNKNOWN",
        message: wrapperMessage ?? null,
        layer: "job",
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
 * Job error adapter:
 * - Wrapper: job/attempt errorCode+message (often RUN_STEP_FAILED)
 * - Root cause: meta.stepErrorCode (step-level failure)
 */
export function resolveJobDisplayError(input: {
  errorCode?: string | null | undefined
  errorMessage?: string | null | undefined
  errorMetaJson?: string | null | undefined
}): JobDisplayError {
  const wrapperCode = input.errorCode ? String(input.errorCode) : null
  const wrapperMessage = input.errorMessage ? String(input.errorMessage) : null
  const meta = parseJobErrorMeta(input.errorMetaJson ?? null)

  const resolved = resolveDisplayError(buildJobErrorEnvelope(input))
  const displayCode = resolved?.display?.code ? String(resolved.display.code) : wrapperCode
  return { displayCode: displayCode ?? null, wrapperCode, wrapperMessage, meta }
}

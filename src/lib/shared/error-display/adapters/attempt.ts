import { resolveDisplayError } from "@/lib/shared/error-display/resolve-display-error"
import type { ErrorEnvelope } from "@/lib/shared/error-display/types"
import { parseJobErrorMeta } from "@/lib/shared/error-display/adapters/job"
import { toMetaRecord } from "@/lib/shared/error-display/to-meta-record"

export type AttemptDisplayError = {
  displayCode: string | null
  wrapperCode: string | null
  wrapperMessage: string | null
  meta: ReturnType<typeof parseJobErrorMeta> | null
}

/**
 * Attempt error adapter:
 * - Wrapper: attempt errorCode + errorMessage (often RUN_STEP_FAILED)
 * - Root cause: meta.stepErrorCode (step-level failure)
 *
 * Note: attempts share the same meta schema as jobs.
 */
export function resolveAttemptDisplayError(input: {
  errorCode?: string | null | undefined
  errorMessage?: string | null | undefined
  errorMetaJson?: string | null | undefined
}): AttemptDisplayError {
  const wrapperCode = input.errorCode ? String(input.errorCode) : null
  const wrapperMessage = input.errorMessage ? String(input.errorMessage) : null
  const meta = parseJobErrorMeta(input.errorMetaJson ?? null)

  const wrapperEnv: ErrorEnvelope | null =
    wrapperCode || wrapperMessage
      ? {
          code: wrapperCode ?? "UNKNOWN",
          message: wrapperMessage ?? null,
          layer: "attempt",
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

  const resolved = resolveDisplayError(wrapperEnv)
  const displayCode = resolved?.display?.code ? String(resolved.display.code) : wrapperCode
  return { displayCode: displayCode ?? null, wrapperCode, wrapperMessage, meta }
}

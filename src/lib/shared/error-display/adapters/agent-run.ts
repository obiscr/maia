import { resolveDisplayError } from "@/lib/shared/error-display/resolve-display-error"
import type { ErrorEnvelope } from "@/lib/shared/error-display/types"
import { toMetaRecord } from "@/lib/shared/error-display/to-meta-record"
import { safeJsonParseObject } from "@/lib/shared/lang/safe-json"

export type AgentRunErrorMeta = {
  // Human-readable detail for debugging (not a stable code).
  detail?: string | null
  // Optional structured root-cause (preferred when available).
  causeCode?: string | null
  causeMessage?: string | null
  causeMeta?: Record<string, unknown> | null
}

export function parseAgentRunErrorMeta(metaJson: string | null | undefined): AgentRunErrorMeta | null {
  const obj = safeJsonParseObject(metaJson)
  if (!obj) return null
  const detail = typeof obj.detail === "string" && obj.detail.trim() ? String(obj.detail) : null
  const causeCode = typeof obj.causeCode === "string" && obj.causeCode.trim() ? String(obj.causeCode) : null
  const causeMessage = typeof obj.causeMessage === "string" && obj.causeMessage.trim() ? String(obj.causeMessage) : null
  const causeMeta =
    obj.causeMeta && typeof obj.causeMeta === "object" && !Array.isArray(obj.causeMeta)
      ? (obj.causeMeta as Record<string, unknown>)
      : null
  return { detail, causeCode, causeMessage, causeMeta }
}

export function buildAgentRunErrorEnvelope(input: {
  errorCode?: string | null | undefined
  errorMessage?: string | null | undefined
  errorMetaJson?: string | null | undefined
}): ErrorEnvelope | null {
  const wrapperCode = input.errorCode ? String(input.errorCode) : null
  const wrapperMessage = input.errorMessage ? String(input.errorMessage) : null
  const meta = parseAgentRunErrorMeta(input.errorMetaJson ?? null)

  // Prefer structured cause fields when present.
  const cause: ErrorEnvelope | null =
    meta?.causeCode && meta.causeCode.trim()
      ? {
          code: String(meta.causeCode),
          message: meta.causeMessage ?? null,
          layer: "system",
          meta: meta.causeMeta ?? toMetaRecord(meta),
        }
      : null

  return wrapperCode || wrapperMessage
    ? {
        code: wrapperCode ?? "UNKNOWN",
        message: wrapperMessage ?? null,
        layer: "system",
        meta: toMetaRecord(meta),
        causes: cause ? [cause] : null,
      }
    : null
}

export type AgentRunDisplayError = {
  displayCode: string | null
  wrapperCode: string | null
  wrapperMessage: string | null
  meta: AgentRunErrorMeta | null
}

export function resolveAgentRunDisplayError(input: {
  errorCode?: string | null | undefined
  errorMessage?: string | null | undefined
  errorMetaJson?: string | null | undefined
}): AgentRunDisplayError {
  const wrapperCode = input.errorCode ? String(input.errorCode) : null
  const wrapperMessage = input.errorMessage ? String(input.errorMessage) : null
  const meta = parseAgentRunErrorMeta(input.errorMetaJson ?? null)
  const resolved = resolveDisplayError(buildAgentRunErrorEnvelope(input))
  const displayCode = resolved?.display?.code ? String(resolved.display.code) : wrapperCode
  return { displayCode: displayCode ?? null, wrapperCode, wrapperMessage, meta }
}

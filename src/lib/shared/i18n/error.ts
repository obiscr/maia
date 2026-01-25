import type { TFunction } from "@/lib/shared/i18n/t"
import { ApiError } from "@/lib/shared/http/api"

export function tError(params: {
  t: TFunction
  code?: string | null
  fallbackKey?: string
  fallbackParams?: Record<string, string | number>
}): string {
  const code = String(params.code ?? "").trim()
  if (!code) return params.fallbackKey ? params.t(params.fallbackKey, params.fallbackParams) : code
  const key = `errors.${code}`
  const translated = params.t(key)
  // createT returns the key itself when missing.
  if (translated === key) return params.fallbackKey ? params.t(params.fallbackKey, params.fallbackParams) : code
  return translated
}

export function tApiError(params: { t: TFunction; err: unknown; fallbackKey?: string }): string {
  const e = params.err instanceof ApiError ? params.err : null
  const code = e ? String(e.code ?? "").trim() : ""
  const status = e ? e.status : undefined
  return tError({
    t: params.t,
    code,
    fallbackKey: params.fallbackKey,
    fallbackParams: status ? { status } : undefined,
  })
}

import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from "ajv"
import addFormats from "ajv-formats"

import type { ApiIssue } from "@/lib/shared/http/types"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

// Lightweight client-side JSON Schema validation helpers (mirrors server validation style).

const validatorCache = new Map<string, ValidateFunction>()

function cacheKey(schema: unknown) {
  try {
    return JSON.stringify(schema)
  } catch {
    // Non-serializable schemas are unsupported; fallback to a unique key.
    return String(Date.now())
  }
}

export function compileAjvValidator(schema: unknown): ValidateFunction | null {
  const key = cacheKey(schema)
  const cached = validatorCache.get(key)
  if (cached) return cached
  try {
    const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
    addFormats(ajv)
    const validate = ajv.compile((schema ?? {}) as AnySchema)
    validatorCache.set(key, validate)
    return validate
  } catch {
    return null
  }
}

function escapeJsonPointer(seg: string) {
  // RFC6901: "~" => "~0", "/" => "~1"
  return seg.replace(/~/g, "~0").replace(/\//g, "~1")
}

export function toJsonPointerPath(instancePath: string | undefined, missingProperty?: string) {
  const base = instancePath && instancePath.length ? instancePath : ""
  if (missingProperty && missingProperty.length) {
    const sep = base.endsWith("/") || base === "" ? "" : "/"
    return `${base}${sep}${escapeJsonPointer(missingProperty)}` || "/"
  }
  return base || "/"
}

export function ajvErrorsToApiIssues(errors: ErrorObject[]): ApiIssue[] {
  return (errors ?? []).map((e) => {
    const keyword = String(e.keyword ?? "invalid")
    const msg = e.message ? String(e.message) : "Invalid value"
    const paramsObj = isPlainObject(e.params) ? e.params : null
    const missing = typeof paramsObj?.missingProperty === "string" ? String(paramsObj.missingProperty) : undefined
    const additionalRaw = paramsObj?.additionalProperty
    const additional = typeof additionalRaw === "string" ? String(additionalRaw) : undefined
    return {
      // For "additionalProperties", AJV's instancePath points to the object; the offending property name is in params.additionalProperty.
      path: toJsonPointerPath(e.instancePath, keyword === "additionalProperties" ? additional : missing),
      keyword,
      message: msg,
      params: paramsObj ?? undefined,
      schemaPath: e.schemaPath ? String(e.schemaPath) : undefined,
    }
  })
}

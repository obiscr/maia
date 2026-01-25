import Ajv, { type ErrorObject, type ValidateFunction } from "ajv"
import addFormats from "ajv-formats"

import type { JsonSchema } from "@/lib/shared/maia/input-spec"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

export type JsonSchemaIssue = {
  /** JSON Pointer (RFC6901), e.g. "/url" or "/nested/value" */
  path: string
  keyword: string
  message: string
  params?: Record<string, unknown>
  schemaPath?: string
}

const ajv = (() => {
  // NOTE:
  // - strict=false to avoid surprising runtime failures from incomplete schemas in early iterations.
  // - allErrors=true so UI can show a complete missing/invalid list in one shot.
  // - useDefaults=true so server can fill schema defaults (also helps "Generate template" flows).
  const a = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true, useDefaults: true })
  addFormats(a)
  return a
})()

// Cache compiled validators by schema JSON (deterministic stringification on server-side).
const validatorCache = new Map<string, ValidateFunction>()

function toPointerPath(instancePath: string | undefined, missingProperty?: string) {
  const base = instancePath && instancePath.length ? instancePath : ""
  if (missingProperty && missingProperty.length) {
    const sep = base.endsWith("/") || base === "" ? "" : "/"
    return `${base}${sep}${escapeJsonPointer(missingProperty)}` || "/"
  }
  return base || "/"
}

function escapeJsonPointer(seg: string) {
  // RFC6901: "~" => "~0", "/" => "~1"
  return seg.replace(/~/g, "~0").replace(/\//g, "~1")
}

export function compileJsonSchema(schema: JsonSchema): { validate: ValidateFunction; compileError?: string } {
  let key = ""
  try {
    key = JSON.stringify(schema)
  } catch {
    // Non-serializable schemas are unsupported; fallback to a unique key.
    key = String(Date.now())
  }
  const cached = validatorCache.get(key)
  if (cached) return { validate: cached }

  try {
    // Ajv types are stricter than our JsonSchema alias; we keep the runtime contract as "plain object JSON schema".
    const validate = ajv.compile(schema)
    validatorCache.set(key, validate)
    return { validate }
  } catch (e) {
    const neverValidate: ValidateFunction = (() => false) as unknown as ValidateFunction
    return {
      validate: neverValidate,
      compileError: e instanceof Error ? e.message : String(e),
    }
  }
}

export function validateWithJsonSchema(params: { schema: JsonSchema; data: unknown }): {
  ok: boolean
  data: unknown
  issues: JsonSchemaIssue[]
  compileError?: string
} {
  const { validate, compileError } = compileJsonSchema(params.schema)
  if (compileError) {
    return {
      ok: false,
      data: params.data,
      issues: [{ path: "/", keyword: "compile", message: compileError }],
      compileError,
    }
  }

  const ok = validate(params.data) === true
  if (ok) return { ok: true, data: params.data, issues: [] }

  const errors = (validate.errors ?? []) as ErrorObject[]
  const issues: JsonSchemaIssue[] = errors.map((e) => {
    const keyword = String(e.keyword ?? "invalid")
    const msg = e.message ? String(e.message) : "Invalid value"
    const paramsObj = isPlainObject(e.params) ? e.params : null
    const missing = typeof paramsObj?.missingProperty === "string" ? String(paramsObj.missingProperty) : undefined
    const additionalRaw = paramsObj?.additionalProperty
    const additional = typeof additionalRaw === "string" ? String(additionalRaw) : undefined
    return {
      path: toPointerPath(e.instancePath, keyword === "additionalProperties" ? additional : missing),
      keyword,
      message: msg,
      params: paramsObj ?? undefined,
      schemaPath: e.schemaPath ? String(e.schemaPath) : undefined,
    }
  })

  return { ok: false, data: params.data, issues }
}

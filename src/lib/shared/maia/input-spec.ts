import { z } from "zod"
import { isRecord } from "@/lib/shared/lang/is-record"

/**
 * WorkflowInputSpec
 * - paramsSchema: JSON Schema for `initialInput` (user params only; `files` is reserved for system use)
 * - filesInput: declarative constraints + UI labels for URL/upload files inputs (validated in /api/jobs)
 * - examples: example payloads to prefill UI and guide the agent
 */

export type JsonSchema = Record<string, unknown>

/**
 * Reserved top-level keys in the user-provided "initialInput" object.
 *
 * These keys are system-managed or have special meaning in the runtime context (ctx),
 * so users should neither send them in initialInput nor define them in paramsSchema/examples.
 */
export const MAIA_RESERVED_INITIAL_INPUT_KEYS = ["files", "upstream", "urlFiles"] as const
export type MaiaReservedInitialInputKey = (typeof MAIA_RESERVED_INITIAL_INPUT_KEYS)[number]

export function listReservedInitialInputKeys(): MaiaReservedInitialInputKey[] {
  return [...MAIA_RESERVED_INITIAL_INPUT_KEYS]
}

export function findReservedKeysInRecord(rec: Record<string, unknown>, keys: readonly string[]): string[] {
  const found: string[] = []
  for (const k of keys) {
    const kk = String(k || "").trim()
    if (!kk) continue
    if (Object.prototype.hasOwnProperty.call(rec, kk)) found.push(kk)
  }
  return found
}

/** Backward-compatible helper: uses the default reserved key list. */
export function findReservedInitialInputKeysInRecord(rec: Record<string, unknown>): MaiaReservedInitialInputKey[] {
  return findReservedKeysInRecord(rec, MAIA_RESERVED_INITIAL_INPUT_KEYS) as MaiaReservedInitialInputKey[]
}

export function validateWorkflowInputSpecReservedKeys(spec: WorkflowInputSpec): {
  reservedKeys: string[]
} {
  return validateWorkflowInputSpecReservedKeysWithKeys(spec, MAIA_RESERVED_INITIAL_INPUT_KEYS)
}

export function validateWorkflowInputSpecReservedKeysWithKeys(
  spec: WorkflowInputSpec,
  keys: readonly string[],
): {
  reservedKeys: string[]
} {
  const bad = new Set<string>()

  // paramsSchema: only enforce at the root object (initialInput is top-level).
  const schema = spec.paramsSchema
  if (isRecord(schema)) {
    const props = isRecord(schema.properties) ? schema.properties : null
    if (props) {
      for (const k of keys) if (Object.prototype.hasOwnProperty.call(props, String(k))) bad.add(String(k))
    }
    const required = Array.isArray(schema.required) ? schema.required : null
    if (required) {
      for (const v of required) {
        const key = typeof v === "string" ? v.trim() : ""
        if (key && keys.includes(key)) bad.add(key)
      }
    }
  }

  // examples[].params: also root-level.
  if (Array.isArray(spec.examples)) {
    for (const ex of spec.examples) {
      const p = isRecord(ex) ? (ex as Record<string, unknown>).params : null
      if (!isRecord(p)) continue
      for (const k of findReservedKeysInRecord(p, keys)) bad.add(k)
    }
  }

  return { reservedKeys: [...bad] }
}

/**
 * Enforce reserved keys at the JSON Schema level using `propertyNames`.
 *
 * This is stronger than checking `properties` because it rejects ANY user-provided reserved key,
 * even if the schema doesn't explicitly declare it.
 *
 * If user already has `propertyNames` (or `allOf`), we combine constraints via `allOf` instead of overwriting.
 */
export function withReservedKeyGuardsInParamsSchema(schema: JsonSchema, reservedKeys?: readonly string[]): JsonSchema {
  if (!isRecord(schema)) return schema

  const type = schema.type
  // Only apply when schema is (or is likely intended to be) an object schema.
  // Runtime contract already enforces object for inputSpec workflows.
  if (typeof type === "string" && type !== "object") return schema

  const reserved = (reservedKeys?.length ? [...reservedKeys] : [...MAIA_RESERVED_INITIAL_INPUT_KEYS]).map((x) =>
    String(x),
  )
  const guard = { propertyNames: { not: { enum: reserved } } }

  const allOf = Array.isArray((schema as Record<string, unknown>).allOf)
    ? ((schema as Record<string, unknown>).allOf as unknown[])
    : null
  const hasPropertyNames = Object.prototype.hasOwnProperty.call(schema, "propertyNames")

  if (allOf) {
    return { ...(schema as Record<string, unknown>), allOf: [...allOf, guard] } as JsonSchema
  }
  if (hasPropertyNames) {
    return { allOf: [schema, guard] } as JsonSchema
  }
  return { ...(schema as Record<string, unknown>), ...guard } as JsonSchema
}

const workflowInputSpecSchemaV1 = z.object({
  version: z.literal(1).default(1),

  /**
   * JSON Schema for the user-provided initialInput object.
   * Must be a valid JSON Schema (Ajv will compile & validate).
   */
  paramsSchema: z.record(z.string(), z.unknown()),

  // Deprecated (UI schema was removed). Still accepted for backwards compatibility.
  uiSchema: z.unknown().optional(),

  /**
   * Declarative constraints for the separate Files tab (urlFiles + uploads).
   * We keep this separate from paramsSchema because `initialInput.files` is a system-managed field.
   */
  fileInputs: z
    .object({
      urlFiles: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          enabled: z.boolean().optional().default(true),
          required: z.boolean().optional().default(false),
          maxItems: z.number().int().positive().optional(),
        })
        .optional(),
      uploads: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          enabled: z.boolean().optional().default(true),
          required: z.boolean().optional().default(false),
          maxItems: z.number().int().positive().optional(),
          /**
           * Allowed MIME types (best-effort). Example: ["application/pdf","image/png"].
           */
          acceptMime: z.array(z.string().min(1)).optional(),
        })
        .optional(),
    })
    .optional(),

  /**
   * Example inputs to prefill the Create Job UI and guide the agent.
   */
  examples: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        params: z.unknown().default({}),
        urlFiles: z.array(z.object({ url: z.string().min(1), name: z.string().optional() })).optional(),
        // uploads are not serializable here (user picks local files), but you can describe them.
        uploadNotes: z.string().optional(),
      }),
    )
    .optional(),
})

const workflowInputSpecSchemaV2 = z.object({
  version: z.literal(2),

  /**
   * JSON Schema for the user-provided initialInput object.
   * Must be a valid JSON Schema (Ajv will compile & validate).
   */
  paramsSchema: z.record(z.string(), z.unknown()),

  /**
   * Declarative constraints for the separate Files inputs (urlFiles + uploadFiles).
   * We keep this separate from paramsSchema because `initialInput.files` is a system-managed field.
   */
  filesInput: z
    .object({
      urlFiles: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          enabled: z.boolean().optional().default(true),
          required: z.boolean().optional().default(false),
          maxItems: z.number().int().positive().optional(),
        })
        .optional(),
      uploadFiles: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          enabled: z.boolean().optional().default(true),
          required: z.boolean().optional().default(false),
          maxItems: z.number().int().positive().optional(),
          acceptMime: z.array(z.string().min(1)).optional(),
        })
        .optional(),
    })
    .optional(),

  /**
   * Example inputs to prefill the Create Job UI and guide the agent.
   */
  examples: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        params: z.unknown().default({}),
        urlFiles: z.array(z.object({ url: z.string().min(1), name: z.string().optional() })).optional(),
        uploadNotes: z.string().optional(),
      }),
    )
    .optional(),
})

type WorkflowInputSpecV1 = z.infer<typeof workflowInputSpecSchemaV1>
export type WorkflowInputSpecV2 = z.infer<typeof workflowInputSpecSchemaV2>

/**
 * Public type: always the normalized v2 shape.
 * (We still parse v1 for backward compatibility, but callers should not depend on v1 fields.)
 */
export type WorkflowInputSpec = WorkflowInputSpecV2

function parseWorkflowInputSpecV1(parsed: unknown): { spec: WorkflowInputSpecV2 | null; error?: string } {
  const r = workflowInputSpecSchemaV1.safeParse(parsed)
  if (!r.success) return { spec: null, error: r.error.message }
  return { spec: normalizeWorkflowInputSpec(r.data) }
}

function parseWorkflowInputSpecV2(parsed: unknown): { spec: WorkflowInputSpecV2 | null; error?: string } {
  if (isRecord(parsed)) {
    const obj: Record<string, unknown> = { ...(parsed as Record<string, unknown>) }
    if (obj.filesInput == null && isRecord(obj.fileInputs)) {
      const fi = obj.fileInputs as Record<string, unknown>
      const urlFiles = isRecord(fi.urlFiles) ? (fi.urlFiles as Record<string, unknown>) : null
      const uploads = isRecord(fi.uploads) ? (fi.uploads as Record<string, unknown>) : null
      obj.filesInput = {
        ...(urlFiles ? { urlFiles } : {}),
        ...(uploads ? { uploadFiles: uploads } : {}),
      }
    }
    const r2 = workflowInputSpecSchemaV2.safeParse(obj)
    if (!r2.success) return { spec: null, error: r2.error.message }
    return { spec: r2.data }
  }
  const r = workflowInputSpecSchemaV2.safeParse(parsed)
  if (!r.success) return { spec: null, error: r.error.message }
  return { spec: r.data }
}

function detectWorkflowInputSpecVersion(parsed: unknown): 1 | 2 | null {
  if (!isRecord(parsed)) return null
  const v = (parsed as Record<string, unknown>).version
  if (v === 1) return 1
  if (v === 2) return 2

  // No explicit version: infer from field names.
  if ((parsed as Record<string, unknown>).filesInput != null) return 2
  if ((parsed as Record<string, unknown>).fileInputs != null) return 1
  return null
}

export function normalizeWorkflowInputSpec(spec: WorkflowInputSpecV1 | WorkflowInputSpecV2): WorkflowInputSpecV2 {
  if (spec.version === 2) return spec
  const fileInputs = spec.fileInputs
  const urlFiles = fileInputs?.urlFiles
  const uploads = fileInputs?.uploads
  return {
    version: 2,
    paramsSchema: spec.paramsSchema,
    filesInput:
      fileInputs || uploads
        ? {
            ...(urlFiles ? { urlFiles } : {}),
            ...(uploads ? { uploadFiles: uploads } : {}),
          }
        : undefined,
    examples: spec.examples,
  }
}

export function extractJsonSchemaObjectShape(schema: unknown): {
  properties: Record<string, unknown> | null
  required: string[]
} {
  // We only need a best-effort "field presence" view for UI/template generation.
  // Ajv is the source of truth for validation.
  if (!isRecord(schema)) return { properties: null, required: [] }

  const rootType = schema.type
  if (typeof rootType === "string" && rootType !== "object") {
    // Non-object params (string/array/etc) => no object shape.
    return { properties: null, required: [] }
  }

  const propsOut: Record<string, unknown> = {}
  const requiredOut = new Set<string>()

  const visit = (node: unknown, depth: number) => {
    if (depth > 8) return
    if (!isRecord(node)) return

    // If a nested schema explicitly claims non-object, we ignore it for object-shape discovery.
    // (Real validation is handled by Ajv anyway.)
    const t = node.type
    if (typeof t === "string" && t !== "object") return

    if (isRecord(node.properties)) {
      for (const [k, v] of Object.entries(node.properties)) {
        if (!Object.prototype.hasOwnProperty.call(propsOut, k)) propsOut[k] = v
      }
    }

    if (Array.isArray(node.required)) {
      for (const r of node.required) {
        const key = typeof r === "string" ? r.trim() : ""
        if (key) requiredOut.add(key)
      }
    }

    const branches = (k: "allOf" | "anyOf" | "oneOf") => (Array.isArray(node[k]) ? (node[k] as unknown[]) : null)
    for (const k of ["allOf", "anyOf", "oneOf"] as const) {
      const arr = branches(k)
      if (!arr) continue
      for (const sub of arr) visit(sub, depth + 1)
    }
  }

  visit(schema, 0)

  const required = [...requiredOut]
  const properties = Object.keys(propsOut).length ? propsOut : null
  return { properties, required }
}

/**
 * Convenience wrapper: extract params object shape from a workflow input spec.
 * Centralizes the "how do we read JSON Schema shape" logic for UI.
 */
export function workflowInputSpecParamsShape(spec: WorkflowInputSpec | null | undefined): {
  properties: Record<string, unknown> | null
  required: string[]
} {
  return extractJsonSchemaObjectShape(spec?.paramsSchema)
}

/**
 * Returns true if the workflow input spec indicates that user params should be editable as JSON.
 *
 * UX intent:
 * - If paramsSchema is effectively an "empty object" (no properties, no required, no meaningful example params),
 *   we hide the params editor and only show file inputs (urlFiles/uploadFiles) when enabled.
 * - If paramsSchema is non-object (string/number/array/etc), we must show the editor because params aren't a key/value object.
 * - If examples contain non-empty params, we show the editor even if schema properties/required are empty.
 */
export function workflowInputSpecHasParams(spec: WorkflowInputSpec | null | undefined): boolean {
  if (!spec) return false

  const schema = spec.paramsSchema
  // Spec is validated as a record via zod, but we still defensively guard.
  if (!schema || !isRecord(schema)) return false

  const type = schema.type
  if (typeof type === "string" && type !== "object") return true

  const shape = extractJsonSchemaObjectShape(schema)
  const hasProps = !!shape.properties && Object.keys(shape.properties).length > 0
  const hasRequired = Array.isArray(shape.required) && shape.required.length > 0

  const exampleHasParams = Array.isArray(spec.examples)
    ? spec.examples.some((ex) => {
        const p = isRecord(ex) ? (ex as Record<string, unknown>).params : null
        // If example params is a non-empty object, treat that as a signal that params exist.
        return isRecord(p) && Object.keys(p).length > 0
      })
    : false

  // If schema is the default empty object + no meaningful examples, treat it as "no params required".
  return hasProps || hasRequired || exampleHasParams
}

export function parseWorkflowInputSpec(raw: string | null | undefined): {
  spec: WorkflowInputSpec | null
  error?: string
  reservedKeys?: string[]
} {
  return parseWorkflowInputSpecWithOpts(raw, undefined)
}

export function parseWorkflowInputSpecWithOpts(
  raw: string | null | undefined,
  opts?: { reservedKeys?: readonly string[] } | null,
): {
  spec: WorkflowInputSpec | null
  error?: string
  reservedKeys?: string[]
} {
  const s = typeof raw === "string" ? raw.trim() : ""
  if (!s) return { spec: null }
  try {
    const parsed = JSON.parse(s) as unknown
    const detected = detectWorkflowInputSpecVersion(parsed)
    const parsedRes =
      detected === 1
        ? parseWorkflowInputSpecV1(parsed)
        : detected === 2
          ? parseWorkflowInputSpecV2(parsed)
          : // Fallback order: try v2 first (newer), then v1.
            (() => {
              const v2 = parseWorkflowInputSpecV2(parsed)
              if (v2.spec) return v2
              const v1 = parseWorkflowInputSpecV1(parsed)
              return v1.spec ? v1 : v2
            })()

    if (!parsedRes.spec) return { spec: null, error: parsedRes.error || "Invalid inputSpec" }
    const spec0 = parsedRes.spec

    // Enforce reserved keys in spec (schema + examples) and harden runtime validation via propertyNames.
    const reservedKeys = validateWorkflowInputSpecReservedKeysWithKeys(
      spec0,
      opts?.reservedKeys?.length ? opts.reservedKeys : MAIA_RESERVED_INITIAL_INPUT_KEYS,
    ).reservedKeys
    if (reservedKeys.length) {
      return {
        spec: null,
        reservedKeys,
        error: `Reserved initialInput keys are not allowed in paramsSchema/examples: ${reservedKeys.join(", ")}`,
      }
    }

    const spec: WorkflowInputSpec = {
      ...spec0,
      paramsSchema: withReservedKeyGuardsInParamsSchema(spec0.paramsSchema, opts?.reservedKeys),
    }
    return { spec }
  } catch (e) {
    return { spec: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export function defaultWorkflowInputSpec(): WorkflowInputSpec {
  return {
    version: 2,
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    filesInput: {
      urlFiles: { enabled: false, required: false },
      uploadFiles: { enabled: false, required: false },
    },
    examples: [
      {
        name: "Example",
        params: {},
      },
    ],
  }
}

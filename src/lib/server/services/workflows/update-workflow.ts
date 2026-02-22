import "server-only"

import crypto from "node:crypto"
import { z } from "zod"
import { WorkflowDepsStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { depsHash, parseDependenciesJson } from "@/lib/server/maia/deps"
import { parseWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"
import {
  validateWorkflowGraph,
  workflowGraphValidationErrorToApiError,
} from "@/lib/shared/maia/workflow-graph-validation"
import { compileJsonSchema } from "@/lib/server/maia/jsonschema"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import type { RequestAuthContext } from "@/lib/server/authz"
import { getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

const stepSchema = z.object({
  stepKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  scriptEsm: z.string().default(""),
  timeoutMs: z.number().int().positive().optional(),
  retryPolicy: z.unknown().optional(),
  deps: z.array(z.string().min(1)).default([]),
})

export const updateWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  dependencies: z.string().default("{}"),
  envJson: z.string().optional(),
  inputSpec: z.string().nullable().optional(),
  outputsSpec: z.string().nullable().optional(),
  steps: z.array(stepSchema).default([]),
})

export async function updateWorkflowByPublicId(params: {
  auth: RequestAuthContext
  viewerAuth: ViewerAuthContext
  workflowId: string
  body: z.infer<typeof updateWorkflowSchema>
}) {
  const { auth, viewerAuth, body } = params
  const workflowPublicId = String(params.workflowId || "")
    .trim()
    .toLowerCase()
  const current = await prisma.workflow.findFirst({
    where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
  })
  if (!current) return { ok: false as const, code: "WORKFLOW_NOT_FOUND" as const }
  await ensureEngineRunning()

  let userDeps: Record<string, string>
  try {
    userDeps = parseDependenciesJson(body.dependencies)
  } catch {
    return { ok: false as const, code: "INVALID_DEPENDENCIES" as const, meta: { field: "dependencies" } }
  }
  const hash = depsHash(userDeps)
  let currentDepsHash: string
  try {
    currentDepsHash = depsHash(parseDependenciesJson(current.dependencies))
  } catch {
    currentDepsHash = "__invalid__"
  }
  const depsCount = Object.keys(userDeps).length
  const depsChanged = currentDepsHash !== hash
  const depsStatus: WorkflowDepsStatus =
    depsCount === 0 ? WorkflowDepsStatus.READY : depsChanged ? WorkflowDepsStatus.IDLE : current.depsStatus

  const hasEnvJsonField = Object.prototype.hasOwnProperty.call(body, "envJson")
  let envJsonNormalized: string | undefined = undefined
  if (hasEnvJsonField) {
    try {
      const parsed = JSON.parse(body.envJson || "{}")
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("envJson must be a JSON object")
      const keyRe = /^[A-Za-z_][A-Za-z0-9_]*$/
      const maxKeyLen = 128
      const maxValLen = 8192
      const obj: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const key = String(k).trim()
        if (!key) continue
        if (/\s/.test(key)) throw new Error(`envJson key contains whitespace: "${key}"`)
        if (key.length > maxKeyLen) throw new Error(`envJson key too long (max ${maxKeyLen}): "${key}"`)
        if (!keyRe.test(key)) throw new Error(`envJson key has invalid format: "${key}"`)
        if (typeof v !== "string") throw new Error(`envJson value must be a string for key "${key}"`)
        if (v.length > maxValLen) throw new Error(`envJson value too long (max ${maxValLen}) for key "${key}"`)
        obj[key] = v
      }
      envJsonNormalized = JSON.stringify(
        Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))),
        null,
        2,
      )
    } catch {
      return { ok: false as const, code: "INVALID_ENV_JSON" as const, meta: { field: "envJson" } }
    }
  }

  const hasInputSpecField = Object.prototype.hasOwnProperty.call(body, "inputSpec")
  let inputSpec: string | null | undefined = undefined
  if (hasInputSpecField) {
    const trimmed = typeof body.inputSpec === "string" ? body.inputSpec.trim() : ""
    inputSpec = trimmed.length ? trimmed : null
    if (inputSpec) {
      try {
        const j = JSON.parse(inputSpec) as unknown
        if (j && typeof j === "object" && !Array.isArray(j) && Object.keys(j as Record<string, unknown>).length === 0) {
          inputSpec = null
        }
      } catch {}
    }
    if (inputSpec) {
      const parsed = parseWorkflowInputSpec(inputSpec)
      if (!parsed.spec) {
        if (parsed.reservedKeys?.length) {
          return {
            ok: false as const,
            code: "INVALID_INPUT_SPEC_RESERVED_FIELDS" as const,
            meta: { field: "inputSpec", reservedKeys: parsed.reservedKeys },
          }
        }
        return { ok: false as const, code: "INVALID_INPUT_SPEC" as const, meta: { field: "inputSpec" } }
      }
      const compiled = compileJsonSchema(parsed.spec.paramsSchema)
      if (compiled.compileError) {
        return { ok: false as const, code: "INVALID_INPUT_SPEC_SCHEMA" as const, meta: { field: "inputSpec" } }
      }
      inputSpec = JSON.stringify(parsed.spec, null, 2)
    }
  }

  const hasOutputsSpecField = Object.prototype.hasOwnProperty.call(body, "outputsSpec")
  let outputsSpec: string | null | undefined = undefined
  if (hasOutputsSpecField) {
    const trimmed = typeof body.outputsSpec === "string" ? body.outputsSpec.trim() : ""
    outputsSpec = trimmed.length ? trimmed : null
    if (outputsSpec) {
      try {
        const j = JSON.parse(outputsSpec) as unknown
        if (j && typeof j === "object" && !Array.isArray(j) && Object.keys(j as Record<string, unknown>).length === 0) {
          outputsSpec = null
        }
      } catch {}
    }
    if (outputsSpec) {
      const parsed = parseWorkflowOutputsSpec(outputsSpec)
      if (!parsed.spec)
        return { ok: false as const, code: "INVALID_OUTPUTS_SPEC" as const, meta: { field: "outputsSpec" } }
      outputsSpec = JSON.stringify(parsed.spec, null, 2)
    }
  }

  const steps = body.steps ?? []
  const graphOk = validateWorkflowGraph(steps)
  if (!graphOk.ok) {
    const mapped = workflowGraphValidationErrorToApiError(graphOk.error)
    return { ok: false as const, code: mapped.code, meta: mapped.meta }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const shouldResetDepsState = depsChanged || depsCount === 0
    const wf = await tx.workflow.update({
      where: { id: current.id },
      data: {
        name: body.name,
        description: body.description ?? null,
        ...makeUpdateAudit(auth),
        dependencies: body.dependencies,
        ...(hasEnvJsonField ? { envJson: envJsonNormalized ?? "{}" } : {}),
        ...(hasInputSpecField ? { inputSpec } : {}),
        ...(hasOutputsSpecField ? { outputsSpec } : {}),
        depsHash: hash,
        depsStatus,
        ...(shouldResetDepsState
          ? {
              depsErrorCode: null,
              depsErrorMessage: null,
              depsErrorMetaJson: null,
              depsErrorAt: null,
              depsUpdatedAt: new Date(),
            }
          : {}),
      },
    })

    await tx.workflowStepDep.deleteMany({ where: { workflowId: current.id } })
    await tx.workflowStep.deleteMany({ where: { workflowId: current.id } })
    if (steps.length) {
      await tx.workflowStep.createMany({
        data: steps.map((s) => ({
          id: crypto.randomUUID(),
          workflowId: current.id,
          key: s.stepKey,
          name: s.name,
          description: s.description ?? null,
          scriptEsm: s.scriptEsm,
          timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
          retryPolicyJson: JSON.stringify(s.retryPolicy ?? {}),
        })),
      })
      const edges: { stepId: string; dependsOnStepId: string }[] = []
      for (const s of steps) for (const d of s.deps) edges.push({ stepId: s.stepKey, dependsOnStepId: d })
      if (edges.length) {
        await tx.workflowStepDep.createMany({
          data: edges.map((e) => ({
            id: crypto.randomUUID(),
            workflowId: current.id,
            stepId: e.stepId,
            dependsOnStepId: e.dependsOnStepId,
          })),
        })
      }
    }
    return wf
  })
  return { ok: true as const, workflow: { ...updated, id: updated.publicId } }
}

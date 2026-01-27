import crypto from "node:crypto"
import { z } from "zod"
import { WorkflowDepsStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { mark, withApiObservability } from "@/lib/server/observability"
import { depsHash, parseDependenciesJson } from "@/lib/server/maia/deps"
import { parseWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"
import { compileJsonSchema } from "@/lib/server/maia/jsonschema"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { requireRequestAuth } from "@/lib/server/authz"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import { getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

const stepSchema = z.object({
  stepKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  scriptEsm: z.string().default(""),
  timeoutMs: z.number().int().positive().optional(),
  retryPolicy: z.unknown().optional(),
  deps: z.array(z.string().min(1)).default([]),
})

const updateWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  dependencies: z.string().default("{}"),
  envJson: z.string().optional(),
  inputSpec: z.string().nullable().optional(),
  outputsSpec: z.string().nullable().optional(),
  steps: z.array(stepSchema).default([]),
})

const patchMetaSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    // allow null to clear; allow undefined to omit
    description: z.string().optional().nullable(),
  })
  .refine(
    (v) => Object.prototype.hasOwnProperty.call(v, "name") || Object.prototype.hasOwnProperty.call(v, "description"),
    {
      message: "INVALID_BODY",
    },
  )

export const GET = withApiObservability(async (_: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()
  const wf = await prisma.workflow.findFirst({
    where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
  })
  if (!wf) return notFound("WORKFLOW_NOT_FOUND")

  // For weak/no-UI AI tasks: surface the most recent FAILED AgentRun for this workflow,
  // so the editor can show an alert on next visit.
  const lastFailedAgentRun = await prisma.agentRun.findFirst({
    where: {
      workflowId: wf.publicId,
      status: "FAILED",
    },
    orderBy: [{ errorAt: "desc" }, { createdAt: "desc" }],
    select: {
      publicId: true,
      type: true,
      errorCode: true,
      errorMessage: true,
      errorAt: true,
    },
  })

  const steps = await prisma.workflowStep.findMany({ where: { workflowId: wf.id }, orderBy: [{ key: "asc" }] })
  const deps = await prisma.workflowStepDep.findMany({ where: { workflowId: wf.id } })
  const depMap = new Map<string, string[]>()
  for (const d of deps) {
    const arr = depMap.get(d.stepId) ?? []
    arr.push(d.dependsOnStepId)
    depMap.set(d.stepId, arr)
  }

  return ok({
    workflow: {
      // API/UI convention: `id` is the human-friendly public id (avoid leaking internal UUIDs).
      id: wf.publicId,
      publicId: wf.publicId,
      publicNumber: wf.publicNumber,
      name: wf.name,
      description: wf.description,
      dependencies: wf.dependencies,
      envJson: wf.envJson,
      inputSpec: wf.inputSpec,
      outputsSpec: wf.outputsSpec,
      depsHash: wf.depsHash,
      depsStatus: wf.depsStatus,
      depsErrorCode: wf.depsErrorCode,
      depsErrorMessage: wf.depsErrorMessage,
      depsErrorMetaJson: wf.depsErrorMetaJson,
      depsErrorAt: wf.depsErrorAt,
      depsUpdatedAt: wf.depsUpdatedAt,
      agentRunLastError: lastFailedAgentRun
        ? {
            agentRunId: lastFailedAgentRun.publicId,
            type: lastFailedAgentRun.type,
            errorCode: lastFailedAgentRun.errorCode,
            errorMessage: lastFailedAgentRun.errorMessage,
            errorAt: lastFailedAgentRun.errorAt,
          }
        : null,
      createdAt: wf.createdAt,
      updatedAt: wf.updatedAt,
      steps: steps.map((s) => ({
        stepKey: s.key,
        name: s.name,
        description: s.description,
        scriptEsm: s.scriptEsm,
        timeoutMs: s.timeoutMs,
        retryPolicy: (() => {
          try {
            return s.retryPolicyJson ? JSON.parse(String(s.retryPolicyJson)) : undefined
          } catch {
            return undefined
          }
        })(),
        deps: depMap.get(s.key) ?? [],
      })),
    },
  })
})

export const PUT = withApiObservability(async (req: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  await ensureEngineRunning()
  mark("engine")
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()
  const current = await prisma.workflow.findFirst({
    where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
  })
  if (!current) return notFound("WORKFLOW_NOT_FOUND")
  let body: z.infer<typeof updateWorkflowSchema>
  try {
    body = updateWorkflowSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    }
    throw e
  }

  let userDeps: Record<string, string>
  try {
    userDeps = parseDependenciesJson(body.dependencies)
  } catch (e) {
    return fail({
      status: 400,
      code: "INVALID_DEPENDENCIES",
      meta: { field: "dependencies" },
    })
  }
  const hash = depsHash(userDeps)
  // Only require re-install when deps actually change. Do NOT reset depsStatus on unrelated edits.
  // (Previously, any workflow save would set depsStatus=IDLE for non-empty deps, even if already installed.)
  let currentDepsHash: string
  try {
    currentDepsHash = depsHash(parseDependenciesJson(current.dependencies))
  } catch {
    // Shouldn't happen, but if the stored JSON is invalid, treat as changed.
    currentDepsHash = "__invalid__"
  }
  const depsCount = Object.keys(userDeps).length
  const depsChanged = currentDepsHash !== hash
  const depsStatus: WorkflowDepsStatus =
    depsCount === 0 ? WorkflowDepsStatus.READY : depsChanged ? WorkflowDepsStatus.IDLE : current.depsStatus

  const hasEnvJsonField = Object.prototype.hasOwnProperty.call(body, "envJson")
  let envJsonNormalized: string | undefined = undefined
  if (hasEnvJsonField) {
    // Validate workflow env JSON (flat string map)
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
    } catch (e) {
      return fail({
        status: 400,
        code: "INVALID_ENV_JSON",
        meta: { field: "envJson" },
      })
    }
  }

  const hasInputSpecField = Object.prototype.hasOwnProperty.call(body, "inputSpec")
  let inputSpec: string | null | undefined = undefined
  if (hasInputSpecField) {
    const trimmed = typeof body.inputSpec === "string" ? body.inputSpec.trim() : ""
    inputSpec = trimmed.length ? trimmed : null
    if (inputSpec) {
      // Treat {} as "unset" (common user expectation when clearing the editor).
      try {
        const j = JSON.parse(inputSpec) as unknown
        if (j && typeof j === "object" && !Array.isArray(j) && Object.keys(j as Record<string, unknown>).length === 0) {
          inputSpec = null
        }
      } catch {
        // ignore here; parseWorkflowInputSpec will produce a helpful error below
      }
    }
    if (inputSpec) {
      const parsed = parseWorkflowInputSpec(inputSpec)
      if (!parsed.spec) {
        if (parsed.reservedKeys?.length) {
          return fail({
            status: 400,
            code: "INVALID_INPUT_SPEC_RESERVED_FIELDS",
            meta: { field: "inputSpec", reservedKeys: parsed.reservedKeys },
          })
        }
        return fail({ status: 400, code: "INVALID_INPUT_SPEC", meta: { field: "inputSpec" } })
      }
      const compiled = compileJsonSchema(parsed.spec.paramsSchema)
      if (compiled.compileError) {
        return fail({
          status: 400,
          code: "INVALID_INPUT_SPEC_SCHEMA",
          meta: { field: "inputSpec" },
        })
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
      // Treat {} as "unset" (common user expectation when clearing the editor).
      try {
        const j = JSON.parse(outputsSpec) as unknown
        if (j && typeof j === "object" && !Array.isArray(j) && Object.keys(j as Record<string, unknown>).length === 0) {
          outputsSpec = null
        }
      } catch {
        // ignore here; parseWorkflowOutputsSpec will produce a helpful error below
      }
    }
    if (outputsSpec) {
      const parsed = parseWorkflowOutputsSpec(outputsSpec)
      if (!parsed.spec) {
        return fail({ status: 400, code: "INVALID_OUTPUTS_SPEC", meta: { field: "outputsSpec" } })
      }
      outputsSpec = JSON.stringify(parsed.spec, null, 2)
    }
  }

  const steps = body.steps ?? []

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
          retryPolicyJson: JSON.stringify((s as any).retryPolicy ?? {}),
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
  mark("db.tx")

  // API/UI convention: avoid leaking internal UUIDs.
  return ok({ workflow: { ...updated, id: updated.publicId } })
})

export const PATCH = withApiObservability(async (req: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()

  let body: z.infer<typeof patchMetaSchema>
  try {
    body = patchMetaSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    }
    throw e
  }

  const current = await prisma.workflow.findFirst({
    where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
  })
  if (!current) return notFound("WORKFLOW_NOT_FOUND")

  const data: { name?: string; description?: string | null } = {}
  if (Object.prototype.hasOwnProperty.call(body, "name")) data.name = (body.name ?? "").trim()
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    const d = body.description
    data.description = typeof d === "string" && d.trim().length ? d.trim() : null
  }

  const updated = await prisma.workflow.update({
    where: { id: current.id },
    data: { ...data, ...makeUpdateAudit(auth) },
  })

  // API/UI convention: avoid leaking internal UUIDs.
  return ok({ workflow: { ...updated, id: updated.publicId } })
})

export const DELETE = withApiObservability(async (_: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  await ensureEngineRunning()
  mark("engine")
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()
  const current = await prisma.workflow.findFirst({
    where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
    select: { id: true },
  })
  if (!current) return notFound("WORKFLOW_NOT_FOUND")
  // Workflow is referenced by JobRun/Schedule/Batch/Run with onDelete: Restrict, so we must
  // remove dependents first to avoid FK constraint failures.
  await prisma.$transaction(async (tx) => {
    await tx.jobRun.deleteMany({ where: { workflowId: current.id } })
    await tx.batch.deleteMany({ where: { workflowId: current.id } })
    await tx.schedule.deleteMany({ where: { workflowId: current.id } })
    await tx.run.deleteMany({ where: { workflowId: current.id } })
    await tx.workflow.delete({ where: { id: current.id } })
  })
  mark("db.tx")
  return ok({ ok: true })
})

import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { mark, withApiObservability } from "@/lib/server/observability"
import { depsHash, parseDependenciesJson } from "@/lib/server/maia/deps"
import { parseWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"
import {
  validateWorkflowGraph,
  workflowGraphValidationErrorToApiError,
} from "@/lib/shared/maia/workflow-graph-validation"
import { compileJsonSchema } from "@/lib/server/maia/jsonschema"
import { createWorkflowVersionSnapshot } from "@/lib/server/maia/workflow-versioning"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { allocatePublicId } from "@/lib/server/public-ids"
import { requireRequestAuth } from "@/lib/server/authz"
import { makeCreateAudit } from "@/lib/server/audit/write"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { listWorkflows, listWorkflowsQuerySchema } from "@/lib/server/services/workflows/list-workflows"

export const runtime = "nodejs"

const getQuerySchema = listWorkflowsQuerySchema

const stepSchema = z.object({
  stepKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  scriptEsm: z.string().default(""),
  timeoutMs: z.number().int().positive().optional(),
  retryPolicy: z.unknown().optional(),
  deps: z.array(z.string().min(1)).default([]),
})

const createWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  dependencies: z.string().default("{}"),
  envJson: z.string().default("{}"),
  inputSpec: z.string().nullable().optional(),
  outputsSpec: z.string().nullable().optional(),
  steps: z.array(stepSchema).default([]),
})

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const url = new URL(req.url)
  let qp: z.infer<typeof getQuerySchema>
  try {
    qp = getQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      depsStatus: url.searchParams.get("depsStatus") ?? undefined,
      envConfigured: url.searchParams.get("envConfigured") ?? undefined,
      inputSpecConfigured: url.searchParams.get("inputSpecConfigured") ?? undefined,
      outputsSpecConfigured: url.searchParams.get("outputsSpecConfigured") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    }
    throw e
  }

  return ok(await listWorkflows({ viewerAuth, query: qp }))
})

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  return await runIdempotentOperation({
    req,
    action: "WORKFLOW_CREATE",
    scope: "workflows:create",
    targetType: "workflow",
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      await ensureEngineRunning()
      mark("engine")
      let body: z.infer<typeof createWorkflowSchema>
      try {
        body = createWorkflowSchema.parse(await req.json())
      } catch (e) {
        if (e instanceof z.ZodError) {
          return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
        }
        throw e
      }

      let userDeps: Record<string, string>
      try {
        userDeps = parseDependenciesJson(body.dependencies)
      } catch (e) {
        return {
          status: 400,
          body: {
            code: "INVALID_DEPENDENCIES",
            meta: { field: "dependencies" },
          },
        }
      }
      const hash = depsHash(userDeps)
      const depsStatus = Object.keys(userDeps).length === 0 ? "READY" : "IDLE"

      // Validate workflow env JSON (flat string map)
      let envJsonNormalized = "{}"
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
        return {
          status: 400,
          body: { code: "INVALID_ENV_JSON", meta: { field: "envJson" } },
        }
      }

      const id = crypto.randomUUID()
      const steps = body.steps ?? []

      // Industry-standard graph validation: no unknown deps / duplicates / cycles.
      const graphOk = validateWorkflowGraph(steps)
      if (!graphOk.ok) {
        const mapped = workflowGraphValidationErrorToApiError(graphOk.error)
        return { status: 400, body: mapped }
      }

      let inputSpec: string | null =
        typeof body.inputSpec === "string" && body.inputSpec.trim().length ? body.inputSpec.trim() : null
      if (inputSpec) {
        // Treat {} as "unset" (common user expectation when clearing the editor).
        try {
          const j = JSON.parse(inputSpec) as unknown
          if (
            j &&
            typeof j === "object" &&
            !Array.isArray(j) &&
            Object.keys(j as Record<string, unknown>).length === 0
          ) {
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
            return {
              status: 400,
              body: {
                code: "INVALID_INPUT_SPEC_RESERVED_FIELDS",
                meta: { field: "inputSpec", reservedKeys: parsed.reservedKeys },
              },
            }
          }
          return { status: 400, body: { code: "INVALID_INPUT_SPEC", meta: { field: "inputSpec" } } }
        }
        const compiled = compileJsonSchema(parsed.spec.paramsSchema)
        if (compiled.compileError) {
          return { status: 400, body: { code: "INVALID_INPUT_SPEC_SCHEMA", meta: { field: "inputSpec" } } }
        }
        // Store normalized spec (stable formatting).
        inputSpec = JSON.stringify(parsed.spec, null, 2)
      }

      let outputsSpec: string | null =
        typeof body.outputsSpec === "string" && body.outputsSpec.trim().length ? body.outputsSpec.trim() : null
      if (outputsSpec) {
        // Treat {} as "unset" (common user expectation when clearing the editor).
        try {
          const j = JSON.parse(outputsSpec) as unknown
          if (
            j &&
            typeof j === "object" &&
            !Array.isArray(j) &&
            Object.keys(j as Record<string, unknown>).length === 0
          ) {
            outputsSpec = null
          }
        } catch {
          // ignore here; parseWorkflowOutputsSpec will produce a helpful error below
        }
      }
      if (outputsSpec) {
        const parsed = parseWorkflowOutputsSpec(outputsSpec)
        if (!parsed.spec) {
          return {
            status: 400,
            body: { code: "INVALID_OUTPUTS_SPEC", meta: { field: "outputsSpec" } },
          }
        }
        // Store normalized spec (stable formatting).
        outputsSpec = JSON.stringify(parsed.spec, null, 2)
      }

      const workflow = await prisma.$transaction(async (tx) => {
        const pub = await allocatePublicId(tx, "workflow")
        // NOTE: Prisma Client types for this workspace can lag behind schema changes until
        // the TypeScript server reloads. We still persist envJson at runtime; keep this cast
        // to avoid editor/typecheck flakiness after migrations.
        const wf = await tx.workflow.create({
          data: {
            id,
            publicId: pub.publicId,
            publicNumber: pub.publicNumber,
            name: body.name,
            description: body.description ?? null,
            ...makeCreateAudit(auth),
            dependencies: body.dependencies,
            envJson: envJsonNormalized,
            inputSpec,
            outputsSpec,
            depsHash: hash,
            depsStatus,
            depsErrorCode: null,
            depsErrorMessage: null,
            depsErrorMetaJson: null,
            depsErrorAt: null,
          },
        })

        if (steps.length) {
          await tx.workflowStep.createMany({
            data: steps.map((s) => ({
              id: crypto.randomUUID(),
              workflowId: id,
              key: s.stepKey,
              name: s.name,
              description: s.description ?? null,
              scriptEsm: s.scriptEsm,
              timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
              retryPolicyJson: JSON.stringify(s.retryPolicy ?? {}),
            })),
          })

          const depEdges: { stepId: string; dependsOnStepId: string }[] = []
          for (const s of steps) {
            for (const d of s.deps) depEdges.push({ stepId: s.stepKey, dependsOnStepId: d })
          }
          if (depEdges.length) {
            await tx.workflowStepDep.createMany({
              data: depEdges.map((e) => ({
                id: crypto.randomUUID(),
                workflowId: id,
                stepId: e.stepId,
                dependsOnStepId: e.dependsOnStepId,
              })),
            })
          }
        }
        return wf
      })
      mark("db.tx")

      // Create v1 snapshot (immutable).
      // Note: this reads from the request payload rather than re-reading DB tables,
      // but it matches the state we just persisted transactionally above.
      await createWorkflowVersionSnapshot({
        workflowId: workflow.id,
        workflowName: workflow.name,
        description: null,
        createdByUserId: auth.userId,
        dependencies: workflow.dependencies,
        envJson: workflow.envJson ?? "{}",
        inputSpec: workflow.inputSpec ?? null,
        outputsSpec: workflow.outputsSpec ?? null,
        depsHash: workflow.depsHash,
        steps: steps.map((s) => ({
          stepKey: s.stepKey,
          name: s.name,
          scriptEsm: s.scriptEsm,
          timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
          retryPolicy: s.retryPolicy ?? undefined,
          deps: s.deps ?? [],
        })),
      })

      return {
        status: 201,
        headers: { Location: `/api/workflows/${workflow.publicId}` },
        body: {
          // Avoid leaking internal UUIDs.
          workflow: {
            id: workflow.publicId,
            publicId: workflow.publicId,
            publicNumber: workflow.publicNumber,
            name: workflow.name,
            description: workflow.description ?? null,
          },
          operationId,
        },
      }
    },
  })
})

import crypto from "node:crypto"
import { z } from "zod"
import { Prisma } from "@prisma/client"

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
import { getWorkflowsListVisibilityWhere } from "@/lib/server/scopes/workflows-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

const getQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["UPDATED_DESC", "UPDATED_ASC"]).default("UPDATED_DESC"),
  depsStatus: z.enum(["IDLE", "INSTALLING", "READY", "FAILED"]).optional(),
  envConfigured: z.enum(["CONFIGURED", "NOT_CONFIGURED"]).optional(),
  inputSpecConfigured: z.enum(["CONFIGURED", "NOT_CONFIGURED"]).optional(),
  outputsSpecConfigured: z.enum(["CONFIGURED", "NOT_CONFIGURED"]).optional(),
})

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

  const where: Prisma.WorkflowWhereInput | undefined = (() => {
    const parts: Prisma.WorkflowWhereInput[] = []

    const visibilityWhere = getWorkflowsListVisibilityWhere(viewerAuth)
    if (visibilityWhere) parts.push(visibilityWhere)

    if (qp.q && qp.q.length) {
      parts.push({
        OR: [
          { publicId: { contains: qp.q } },
          // NOTE: Prisma "mode: insensitive" is not supported for SQLite.
          // SQLite's LIKE is typically case-insensitive for ASCII unless configured otherwise.
          { name: { contains: qp.q } },
          { description: { contains: qp.q } },
        ],
      })
    }

    if (qp.depsStatus) {
      parts.push({ depsStatus: qp.depsStatus })
    }

    if (qp.envConfigured) {
      parts.push(qp.envConfigured === "CONFIGURED" ? { envJson: { not: "{}" } } : { envJson: { equals: "{}" } })
    }

    if (qp.inputSpecConfigured) {
      parts.push(qp.inputSpecConfigured === "CONFIGURED" ? { inputSpec: { not: null } } : { inputSpec: null })
    }

    if (qp.outputsSpecConfigured) {
      parts.push(qp.outputsSpecConfigured === "CONFIGURED" ? { outputsSpec: { not: null } } : { outputsSpec: null })
    }

    if (!parts.length) return undefined
    if (parts.length === 1) return parts[0]
    return { AND: parts }
  })()

  const orderBy = qp.sort === "UPDATED_ASC" ? [{ updatedAt: "asc" as const }] : [{ updatedAt: "desc" as const }]

  // Unfiltered total count (used by UI to distinguish "no workflows exist" vs "no results for current filters").
  const totalAll = await prisma.workflow.count({ where: getWorkflowsListVisibilityWhere(viewerAuth) })
  const total = await prisma.workflow.count({ where })

  const workflows = await prisma.workflow.findMany({
    where,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      description: true,
      dependencies: true,
      envJson: true,
      inputSpec: true,
      outputsSpec: true,
      depsHash: true,
      depsStatus: true,
      depsErrorCode: true,
      depsErrorMessage: true,
      depsErrorMetaJson: true,
      depsErrorAt: true,
      depsUpdatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  const ids = workflows.map((w) => w.id)
  if (ids.length === 0) {
    return ok({
      workflows: [],
      total,
      totalAll,
      page: qp.page,
      pageSize: qp.pageSize,
      sort: qp.sort,
      q: qp.q ?? "",
      envConfigured: qp.envConfigured ?? null,
      inputSpecConfigured: qp.inputSpecConfigured ?? null,
      outputsSpecConfigured: qp.outputsSpecConfigured ?? null,
    })
  }

  const stepCounts = await prisma.workflowStep.groupBy({
    by: ["workflowId"],
    where: { workflowId: { in: ids } },
    _count: { _all: true },
  })
  const runCounts = await prisma.run.groupBy({
    by: ["workflowId"],
    where: { workflowId: { in: ids } },
    _count: { _all: true },
  })
  const runningCounts = await prisma.run.groupBy({
    by: ["workflowId"],
    where: { workflowId: { in: ids }, status: "RUNNING" },
    _count: { _all: true },
  })

  // Latest workflow version number (immutable snapshots).
  const latestVersions = await prisma.workflowVersion.groupBy({
    by: ["workflowId"],
    where: { workflowId: { in: ids } },
    _max: { version: true },
  })

  // Latest run per workflow + recent success rate (last N runs).
  const RECENT_N = 20
  // NOTE: Use Prisma.join(ids) directly so values are parameterized correctly for IN (...).
  // Using Prisma.sql`${id}` fragments can lead to a single opaque parameter and no matches.
  const idList = Prisma.join(ids)

  type LastRunRow = {
    workflowId: string
    publicId: string
    status: string
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
    workflowVersionNumber: number | null
  }
  const lastRuns = await prisma.$queryRaw<LastRunRow[]>(
    Prisma.sql`
      SELECT workflowId, publicId, status, createdAt, startedAt, finishedAt, workflowVersionNumber
      FROM (
        SELECT
          workflowId,
          publicId,
          status,
          createdAt,
          startedAt,
          finishedAt,
          workflowVersionNumber,
          ROW_NUMBER() OVER (PARTITION BY workflowId ORDER BY createdAt DESC) as rn
        FROM Run
        WHERE workflowId IN (${idList})
      )
      WHERE rn = 1
    `,
  )

  type RecentStatusRow = { workflowId: string; status: string }
  const recentStatuses = await prisma.$queryRaw<RecentStatusRow[]>(
    Prisma.sql`
      SELECT workflowId, status
      FROM (
        SELECT
          workflowId,
          status,
          ROW_NUMBER() OVER (PARTITION BY workflowId ORDER BY createdAt DESC) as rn
        FROM Run
        WHERE workflowId IN (${idList})
      )
      WHERE rn <= ${RECENT_N}
    `,
  )
  mark("db.groupBy")

  const stepMap = new Map(stepCounts.map((r) => [r.workflowId, r._count._all]))
  const runMap = new Map(runCounts.map((r) => [r.workflowId, r._count._all]))
  const runningMap = new Map(runningCounts.map((r) => [r.workflowId, r._count._all]))
  const latestVerMap = new Map(latestVersions.map((r) => [r.workflowId, Number(r._max?.version ?? 0) || 0]))

  const lastRunMap = new Map<string, LastRunRow>()
  for (const r of lastRuns) lastRunMap.set(r.workflowId, r)

  const recentStatsMap = new Map<
    string,
    { completed: number; succeeded: number; pct: number | null; sampleN: number }
  >()
  for (const row of recentStatuses) {
    const cur = recentStatsMap.get(row.workflowId) ?? {
      completed: 0,
      succeeded: 0,
      pct: null as number | null,
      sampleN: 0,
    }
    cur.sampleN += 1
    const st = String(row.status || "").toUpperCase()
    const isCompleted = st === "SUCCEEDED" || st === "FAILED" || st === "CANCELED"
    if (isCompleted) {
      cur.completed += 1
      if (st === "SUCCEEDED") cur.succeeded += 1
    }
    recentStatsMap.set(row.workflowId, cur)
  }
  for (const [k, v] of recentStatsMap.entries()) {
    v.pct = v.completed > 0 ? Math.round((v.succeeded / v.completed) * 100) : null
    recentStatsMap.set(k, v)
  }

  const depsCountFor = (raw: string) => {
    try {
      const obj = parseDependenciesJson(raw ?? "{}")
      return Object.keys(obj).length
    } catch {
      return 0
    }
  }

  const envCountFor = (raw: string) => {
    const txt = typeof raw === "string" ? raw : "{}"
    try {
      const parsed = JSON.parse(txt)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0
      return Object.keys(parsed as Record<string, unknown>).length
    } catch {
      return 0
    }
  }

  return ok({
    workflows: workflows.map((w) => {
      const { inputSpec, outputsSpec, id: internalId, publicId, publicNumber, ...rest } = w
      const hasInputSpec = typeof inputSpec === "string" && inputSpec.trim().length > 0
      const hasOutputsSpec = typeof outputsSpec === "string" && outputsSpec.trim().length > 0
      const lastRun = lastRunMap.get(internalId) ?? null
      const recent = recentStatsMap.get(internalId) ?? {
        completed: 0,
        succeeded: 0,
        pct: null as number | null,
        sampleN: 0,
      }
      return {
        // API/UI convention: `id` is the human-friendly public id (avoid leaking internal UUIDs).
        id: publicId,
        publicId,
        publicNumber,
        ...rest,
        hasInputSpec,
        hasOutputsSpec,
        latestVersionNumber: latestVerMap.get(internalId) ?? 0,
        lastRun: lastRun
          ? {
              id: lastRun.publicId,
              publicId: lastRun.publicId,
              status: lastRun.status,
              createdAt: lastRun.createdAt,
              startedAt: lastRun.startedAt,
              finishedAt: lastRun.finishedAt,
              workflowVersionNumber: lastRun.workflowVersionNumber ?? null,
            }
          : null,
        recentSuccessRatePct: recent.pct,
        recentSuccessRateCompleted: recent.completed,
        recentSuccessRateN: RECENT_N,
        stepCount: stepMap.get(internalId) ?? 0,
        runCount: runMap.get(internalId) ?? 0,
        runningRunCount: runningMap.get(internalId) ?? 0,
        npmDepsCount: depsCountFor(w.dependencies),
        envCount: envCountFor(w.envJson),
      }
    }),
    total,
    totalAll,
    page: qp.page,
    pageSize: qp.pageSize,
    sort: qp.sort,
    q: qp.q ?? "",
    envConfigured: qp.envConfigured ?? null,
    inputSpecConfigured: qp.inputSpecConfigured ?? null,
    outputsSpecConfigured: qp.outputsSpecConfigured ?? null,
  })
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
              retryPolicyJson: JSON.stringify((s as any).retryPolicy ?? {}),
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
          retryPolicy: (s as any).retryPolicy ?? undefined,
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

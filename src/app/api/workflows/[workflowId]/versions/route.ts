import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { createWorkflowVersionSnapshot } from "@/lib/server/maia/workflow-versioning"
import { validateWorkflowGraph, workflowGraphValidationErrorToApiError } from "@/lib/shared/maia/workflow-graph-validation"
import { zodIssues } from "@/lib/shared/http/zod"
import { safeJsonObjectKeyCountOr0 } from "@/lib/shared/lang/safe-json"

export const runtime = "nodejs"

const getWorkflowVersionsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

const createWorkflowVersionBodySchema = z.object({
  description: z.string().max(5000).optional().nullable(),
})

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function safeParseSnapshot(snapshotJson: string): {
  stepsCount: number
  depsEdgesCount: number
  depsHash: string | null
  depsPackagesCount: number
  envVarsCount: number
  inputSpecConfigured: boolean
  outputsSpecConfigured: boolean
} {
  try {
    const snap = asRecord(JSON.parse(snapshotJson))
    const steps = Array.isArray(snap?.steps) ? snap.steps : []
    const stepsCount = steps.length
    const depsEdgesCount = steps.reduce((n: number, s) => {
      const sr = asRecord(s)
      const deps = Array.isArray(sr?.deps) ? sr.deps : []
      return n + deps.length
    }, 0)
    const depsHash = typeof snap?.depsHash === "string" ? String(snap.depsHash) : null
    const depsPackagesCount = safeJsonObjectKeyCountOr0(snap?.dependencies)
    const envVarsCount = safeJsonObjectKeyCountOr0(snap?.envJson)
    const inputSpecConfigured = typeof snap?.inputSpec === "string" && snap.inputSpec.trim().length > 0
    const outputsSpecConfigured = typeof snap?.outputsSpec === "string" && snap.outputsSpec.trim().length > 0
    return {
      stepsCount,
      depsEdgesCount,
      depsHash,
      depsPackagesCount,
      envVarsCount,
      inputSpecConfigured,
      outputsSpecConfigured,
    }
  } catch {
    return {
      stepsCount: 0,
      depsEdgesCount: 0,
      depsHash: null,
      depsPackagesCount: 0,
      envVarsCount: 0,
      inputSpecConfigured: false,
      outputsSpecConfigured: false,
    }
  }
}

export const GET = withApiObservability(async (_: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()

  const url = new URL(_.url)
  let qp: z.infer<typeof getWorkflowVersionsQuerySchema>
  try {
    qp = getWorkflowVersionsQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    }
    throw e
  }

  const wf = await prisma.workflow.findUnique({
    where: { publicId: workflowPublicId },
    select: { id: true, publicId: true, name: true },
  })
  if (!wf) return notFound("WORKFLOW_NOT_FOUND")
  mark("db.workflow")

  const q = (qp.q ?? "").trim()
  const m = q.match(/^v?(\d+)$/i)
  const qVersion = m ? Number(m[1]) : null
  const where =
    q && q.length
      ? {
          workflowId: wf.id,
          OR: [
            ...(Number.isFinite(qVersion) ? [{ version: qVersion as number }] : []),
            { description: { contains: q } },
          ],
        }
      : { workflowId: wf.id }

  const total = await prisma.workflowVersion.count({ where })
  mark("db.versions.count")

  const orderBy =
    qp.sort === "CREATED_ASC"
      ? [{ createdAt: "asc" as const }, { version: "asc" as const }]
      : [{ createdAt: "desc" as const }, { version: "desc" as const }]

  const versions = await prisma.workflowVersion.findMany({
    where,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: { id: true, version: true, snapshotJson: true, description: true, createdAt: true },
  })
  mark("db.versions")

  return ok({
    // Avoid leaking internal UUIDs.
    workflow: { id: wf.publicId, publicId: wf.publicId, name: wf.name },
    total,
    page: qp.page,
    pageSize: qp.pageSize,
    sort: qp.sort,
    q: qp.q ?? "",
    versions: versions.map((v) => {
      const meta = safeParseSnapshot(v.snapshotJson || "{}")
      return {
        // UI key only; avoid leaking internal workflowVersion.id
        id: `${wf.publicId}:v${v.version}`,
        version: v.version,
        createdAt: v.createdAt,
        description: v.description ?? null,
        stepsCount: meta.stepsCount,
        depsEdgesCount: meta.depsEdgesCount,
        depsHash: meta.depsHash,
        depsPackagesCount: meta.depsPackagesCount,
        envVarsCount: meta.envVarsCount,
        inputSpecConfigured: meta.inputSpecConfigured,
        outputsSpecConfigured: meta.outputsSpecConfigured,
      }
    }),
  })
})

export const POST = withApiObservability(async (_: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()

  let body: z.infer<typeof createWorkflowVersionBodySchema> | null = null
  try {
    body = createWorkflowVersionBodySchema.parse(await _.json())
  } catch {
    body = null
  }
  const descTrimmed = typeof body?.description === "string" ? body.description.trim() : ""
  const description = descTrimmed.length ? descTrimmed : null

  const wf = await prisma.workflow.findUnique({
    where: { publicId: workflowPublicId },
    select: {
      id: true,
      publicId: true,
      name: true,
      dependencies: true,
      envJson: true,
      inputSpec: true,
      outputsSpec: true,
      depsHash: true,
    },
  })
  if (!wf) return notFound("WORKFLOW_NOT_FOUND")
  mark("db.workflow")

  const steps = await prisma.workflowStep.findMany({ where: { workflowId: wf.id }, orderBy: [{ key: "asc" }] })
  const deps = await prisma.workflowStepDep.findMany({ where: { workflowId: wf.id } })
  const depMap = new Map<string, string[]>()
  for (const d of deps) {
    const arr = depMap.get(d.stepId) ?? []
    arr.push(d.dependsOnStepId)
    depMap.set(d.stepId, arr)
  }
  mark("db.steps")

  const snapSteps = steps.map((s) => ({
    stepKey: s.key,
    name: s.name,
    scriptEsm: s.scriptEsm ?? "",
    timeoutMs: s.timeoutMs,
    deps: depMap.get(s.key) ?? [],
  }))
  const graphOk = validateWorkflowGraph(snapSteps)
  if (!graphOk.ok) {
    const mapped = workflowGraphValidationErrorToApiError(graphOk.error)
    return fail({ status: 400, code: mapped.code, meta: mapped.meta })
  }

  const created = await createWorkflowVersionSnapshot({
    workflowId: wf.id,
    workflowName: wf.name,
    description,
    dependencies: wf.dependencies,
    envJson: wf.envJson ?? "{}",
    inputSpec: wf.inputSpec ?? null,
    outputsSpec: wf.outputsSpec ?? null,
    depsHash: wf.depsHash,
    steps: snapSteps,
  })
  mark("db.version.create")

  return ok({
    workflow: { id: wf.publicId, publicId: wf.publicId, name: wf.name },
    version: {
      version: created.version,
      createdAt: created.createdAt,
    },
  })
})

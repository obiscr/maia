import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { z } from "zod"
import { zodIssues } from "@/lib/shared/http/zod"
import { parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import type { ApiIssue } from "@/lib/shared/http/types"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeUrlFilesForStorage, parseStoredUrlFilesJson } from "@/lib/server/maia/url-files"
import { requireRequestAuth } from "@/lib/server/authz"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import { getBatchFindFirstWhereByPublicId } from "@/lib/server/scopes/batches-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

const patchBatchSchema = z
  .object({
    name: z.string().trim().max(200).nullable().optional(),
    // Accept version NUMBER (avoid leaking internal UUIDs). Fanout locks this field.
    pinnedWorkflowVersionNumber: z.coerce.number().int().min(1).nullable().optional(),
    // Concurrency controls are operational knobs and remain editable after fanout.
    concurrencyLimit: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    rampUpSeconds: z.coerce.number().int().min(1).max(86_400).nullable().optional(),
    autoMaxConcurrency: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    // Fanout locks this field (policy).
    failFast: z.coerce.boolean().optional(),
    // Fanout locks this field.
    maxFailures: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    sourceJson: z.unknown().optional(),
    urlFiles: z
      .array(
        z.object({
          url: z.string().min(1),
          name: z.string().optional(),
          id: z.string().optional(),
        }),
      )
      .optional(),
  })
  .strict()

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  const batchRow = await prisma.batch.findFirst({
    where: getBatchFindFirstWhereByPublicId(viewerAuth, batchPublicId),
    select: { id: true },
  })
  if (!batchRow) return notFound("NOT_FOUND")
  const statusCounts = await prisma.jobRun.groupBy({
    by: ["status"],
    where: { batchId: batchRow.id },
    _count: { _all: true },
  })
  const jobsByStatus: Record<string, number> = {
    QUEUED: 0,
    PAUSED: 0,
    RUNNING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    CANCELED: 0,
  }
  for (const row of statusCounts) {
    const key = String(row.status)
    const n = Number(row._count?._all ?? 0) || 0
    jobsByStatus[key] = n
  }

  const batch = await prisma.batch.findUnique({
    where: { id: batchRow.id },
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      status: true,
      workflowId: true,
      workflow: { select: { publicId: true, publicNumber: true, name: true } },
      pinnedWorkflowVersion: { select: { version: true, createdAt: true, description: true } },
      concurrencyLimit: true,
      rampUpSeconds: true,
      autoMaxConcurrency: true,
      failFast: true,
      maxFailures: true,
      sourceJson: true,
      urlFilesJson: true,
      fanoutSeedJson: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      _count: { select: { jobRuns: true } },
    },
  })
  if (!batch) return notFound("NOT_FOUND")
  const urlFiles = parseStoredUrlFilesJson(batch.urlFilesJson)
  return ok({
    batch: {
      // API/UI convention: avoid leaking internal UUIDs (including nested objects).
      id: batch.publicId,
      publicId: batch.publicId,
      publicNumber: batch.publicNumber,
      name: batch.name,
      status: batch.status,
      workflowId: batch.workflow?.publicId ?? null,
      workflow: batch.workflow
        ? {
            id: batch.workflow.publicId,
            publicId: batch.workflow.publicId,
            publicNumber: batch.workflow.publicNumber,
            name: batch.workflow.name,
          }
        : null,
      pinnedWorkflowVersion: batch.pinnedWorkflowVersion
        ? {
            version: batch.pinnedWorkflowVersion.version,
            createdAt: batch.pinnedWorkflowVersion.createdAt,
            description: batch.pinnedWorkflowVersion.description ?? null,
          }
        : null,
      concurrencyLimit: typeof batch.concurrencyLimit === "number" ? batch.concurrencyLimit : null,
      rampUpSeconds: typeof batch.rampUpSeconds === "number" ? batch.rampUpSeconds : null,
      autoMaxConcurrency: typeof batch.autoMaxConcurrency === "number" ? batch.autoMaxConcurrency : null,
      failFast: Boolean(batch.failFast),
      maxFailures: typeof batch.maxFailures === "number" ? batch.maxFailures : null,
      sourceJson: batch.sourceJson,
      urlFiles,
      fanoutSeedJson: batch.fanoutSeedJson ?? null,
      jobsTotal: batch._count.jobRuns,
      jobsByStatus,
      createdAt: batch.createdAt,
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
    },
  })
})

export const PATCH = withApiObservability(async (req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()

  let body: z.infer<typeof patchBatchSchema>
  try {
    body = patchBatchSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.batch.findFirst({
        where: getBatchFindFirstWhereByPublicId(viewerAuth, batchPublicId),
        select: {
          id: true,
          workflowId: true,
          pinnedWorkflowVersionId: true,
          startedAt: true,
          urlFilesJson: true,
          _count: { select: { jobRuns: true } },
        },
      })
      if (!existing) return null

      const locked = (existing._count?.jobRuns ?? 0) > 0 || !!existing.startedAt

      const data: Record<string, unknown> = {}
      if (body.name !== undefined) data.name = body.name === null ? null : body.name?.trim() ? body.name.trim() : null
      if (body.sourceJson !== undefined) data.sourceJson = JSON.stringify(body.sourceJson ?? {})

      // Lock-on-fanout fields: pinned version + concurrency limit.
      let nextPinnedWorkflowVersionId: string | null = existing.pinnedWorkflowVersionId ?? null
      if (body.pinnedWorkflowVersionNumber !== undefined) {
        if (locked) return { error: { status: 409, code: "BATCH_LOCKED" as const } }
        if (body.pinnedWorkflowVersionNumber == null) {
          data.pinnedWorkflowVersionId = null
          nextPinnedWorkflowVersionId = null
        } else {
          const ver = body.pinnedWorkflowVersionNumber
          const row = await tx.workflowVersion.findUnique({
            where: { workflowId_version: { workflowId: existing.workflowId, version: ver } },
            select: { id: true },
          })
          if (!row) return { error: { status: 422, code: "INVALID_PINNED_WORKFLOW_VERSION" as const } }
          data.pinnedWorkflowVersionId = row.id
          nextPinnedWorkflowVersionId = row.id
        }
      }
      if (body.concurrencyLimit !== undefined) {
        data.concurrencyLimit = body.concurrencyLimit == null ? null : Math.floor(body.concurrencyLimit)
      }
      if (body.rampUpSeconds !== undefined) {
        data.rampUpSeconds = body.rampUpSeconds == null ? null : Math.floor(body.rampUpSeconds)
      }
      if (body.autoMaxConcurrency !== undefined) {
        data.autoMaxConcurrency = body.autoMaxConcurrency == null ? null : Math.floor(body.autoMaxConcurrency)
      }
      if (body.failFast !== undefined) {
        if (locked) return { error: { status: 409, code: "BATCH_LOCKED" as const } }
        data.failFast = Boolean(body.failFast)
      }
      if (body.maxFailures !== undefined) {
        if (locked) return { error: { status: 409, code: "BATCH_LOCKED" as const } }
        data.maxFailures = body.maxFailures == null ? null : Math.floor(body.maxFailures)
      }

      if (body.urlFiles !== undefined) {
        if (locked) return { error: { status: 409, code: "BATCH_LOCKED" as const } }

        // Resolve workflow version snapshot for validation (prefer pinned if available).
        let version = nextPinnedWorkflowVersionId
          ? await tx.workflowVersion.findUnique({
              where: { id: nextPinnedWorkflowVersionId },
              select: { id: true, version: true, snapshotJson: true, createdAt: true },
            })
          : await getLatestWorkflowVersion(existing.workflowId)
        if (!version) {
          const wf = await tx.workflow.findUnique({
            where: { id: existing.workflowId },
            select: {
              id: true,
              name: true,
              dependencies: true,
              envJson: true,
              inputSpec: true,
              outputsSpec: true,
              depsHash: true,
            },
          })
          if (wf) {
            const steps = await tx.workflowStep.findMany({ where: { workflowId: wf.id }, orderBy: [{ key: "asc" }] })
            const deps = await tx.workflowStepDep.findMany({ where: { workflowId: wf.id } })
            const depMap = new Map<string, string[]>()
            for (const d of deps) {
              const arr = depMap.get(d.stepId) ?? []
              arr.push(d.dependsOnStepId)
              depMap.set(d.stepId, arr)
            }
            await createWorkflowVersionSnapshot({
              workflowId: wf.id,
              workflowName: wf.name,
              description: null,
              createdByUserId: auth.userId,
              dependencies: wf.dependencies,
              envJson: wf.envJson ?? "{}",
              inputSpec: wf.inputSpec ?? null,
              outputsSpec: wf.outputsSpec ?? null,
              depsHash: wf.depsHash,
              steps: steps.map((s) => ({
                stepKey: s.key,
                name: s.name,
                scriptEsm: s.scriptEsm ?? "",
                timeoutMs: s.timeoutMs,
                deps: depMap.get(s.key) ?? [],
              })),
            })
            version = await getLatestWorkflowVersion(wf.id)
          }
        }
        const snapshot = workflowSnapshotSchema.parse(JSON.parse(version?.snapshotJson || "{}"))
        const specParsed = parseWorkflowInputSpecWithOpts(snapshot.inputSpec ?? null, {
          reservedKeys: snapshot.reservedInitialInputKeys,
        })
        if (snapshot.inputSpec && !specParsed.spec) {
          return {
            error: {
              status: 500,
              code: "WORKFLOW_INPUT_SPEC_INVALID" as const,
              meta: { field: "inputSpec" },
            },
          }
        }
        const inputSpec = specParsed.spec
        const urlFiles = normalizeUrlFilesForStorage(body.urlFiles)
        if (inputSpec?.fileInputs?.urlFiles) {
          const enabled = inputSpec.fileInputs.urlFiles.enabled !== false
          if (!enabled && urlFiles.length) {
            const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
            return { error: { status: 422, code: "INVALID_INPUT_FILES" as const, issues } }
          }
          if (
            typeof inputSpec.fileInputs.urlFiles.maxItems === "number" &&
            urlFiles.length > inputSpec.fileInputs.urlFiles.maxItems
          ) {
            const issues: ApiIssue[] = [
              {
                path: "/urlFiles",
                keyword: "maxItems",
                params: { limit: inputSpec.fileInputs.urlFiles.maxItems },
              },
            ]
            return {
              error: {
                status: 422,
                code: "INVALID_INPUT_FILES" as const,
                issues,
                meta: { maxItems: inputSpec.fileInputs.urlFiles.maxItems },
              },
            }
          }
        } else if (urlFiles.length) {
          const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "not_supported", params: { field: "urlFiles" } }]
          return { error: { status: 422, code: "INVALID_INPUT_FILES" as const, issues } }
        }
        data.urlFilesJson = JSON.stringify(urlFiles)
      }

      Object.assign(data, makeUpdateAudit(auth))

      const b = await tx.batch.update({
        where: { id: existing.id },
        data,
        select: {
          id: true,
          publicId: true,
          publicNumber: true,
          name: true,
          status: true,
          workflow: { select: { publicId: true, publicNumber: true, name: true } },
          pinnedWorkflowVersion: { select: { version: true, createdAt: true, description: true } },
          concurrencyLimit: true,
          rampUpSeconds: true,
          autoMaxConcurrency: true,
          failFast: true,
          maxFailures: true,
          sourceJson: true,
          urlFilesJson: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          _count: { select: { jobRuns: true } },
        },
      })
      return { batch: b }
    })

    if (!updated) return notFound("NOT_FOUND")
    if (updated.error) return fail(updated.error)

    // API/UI convention: avoid leaking internal UUIDs.
    const b = updated.batch
    return ok({
      batch: {
        id: b.publicId,
        publicId: b.publicId,
        publicNumber: b.publicNumber,
        name: b.name,
        status: b.status,
        workflowId: b.workflow?.publicId ?? null,
        workflow: b.workflow
          ? {
              id: b.workflow.publicId,
              publicId: b.workflow.publicId,
              publicNumber: b.workflow.publicNumber,
              name: b.workflow.name,
            }
          : null,
        pinnedWorkflowVersion: b.pinnedWorkflowVersion
          ? {
              version: b.pinnedWorkflowVersion.version,
              createdAt: b.pinnedWorkflowVersion.createdAt,
              description: b.pinnedWorkflowVersion.description ?? null,
            }
          : null,
        concurrencyLimit: typeof b.concurrencyLimit === "number" ? b.concurrencyLimit : null,
        rampUpSeconds: typeof b.rampUpSeconds === "number" ? b.rampUpSeconds : null,
        autoMaxConcurrency: typeof b.autoMaxConcurrency === "number" ? b.autoMaxConcurrency : null,
        failFast: Boolean(b.failFast),
        maxFailures: typeof b.maxFailures === "number" ? b.maxFailures : null,
        sourceJson: b.sourceJson,
        urlFiles: parseStoredUrlFilesJson(b.urlFilesJson),
        jobsTotal: b._count.jobRuns,
        createdAt: b.createdAt,
        startedAt: b.startedAt,
        finishedAt: b.finishedAt,
      },
    })
  } catch {
    return fail({ status: 500, code: "UPDATE_FAILED" })
  }
})

export const DELETE = withApiObservability(async (_req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  const existing = await prisma.batch.findFirst({
    where: getBatchFindFirstWhereByPublicId(viewerAuth, batchPublicId),
    select: { id: true },
  })
  if (!existing) return notFound("NOT_FOUND")
  try {
    // NOTE: JobRun.batchId is optional but the relation uses onDelete: Restrict, so we must
    // detach job runs before deleting the batch record.
    await prisma.$transaction([
      prisma.jobRun.updateMany({ where: { batchId: existing.id }, data: { batchId: null } }),
      prisma.batch.delete({ where: { id: existing.id } }),
    ])
  } catch {
    return fail({ status: 500, code: "DELETE_FAILED" })
  }
  return ok({ ok: true })
})

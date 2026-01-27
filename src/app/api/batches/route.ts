import crypto from "node:crypto"
import { z } from "zod"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { allocatePublicId } from "@/lib/server/public-ids"
import { isRecord } from "@/lib/shared/lang/is-record"
import { parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import type { ApiIssue } from "@/lib/shared/http/types"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeUrlFilesForStorage } from "@/lib/server/maia/url-files"
import { requireRequestAuth } from "@/lib/server/authz"
import { makeCreateAudit } from "@/lib/server/audit/write"
import { getBatchesListVisibilityWhere } from "@/lib/server/scopes/batches-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { getWorkflowFindFirstWhereById, getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"

export const runtime = "nodejs"

type JobRunStatusKey = "QUEUED" | "PAUSED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED"
const JOB_RUN_STATUS_KEYS: ReadonlyArray<JobRunStatusKey> = [
  "QUEUED",
  "PAUSED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
] as const
function emptyJobsByStatus(): Record<JobRunStatusKey, number> {
  return { QUEUED: 0, PAUSED: 0, RUNNING: 0, SUCCEEDED: 0, FAILED: 0, CANCELED: 0 }
}

const getBatchesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["CREATED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

const createBatchSchema = z.object({
  name: z.string().trim().max(200).optional().default(""),
  workflowId: z.string().min(1),
  pinnedWorkflowVersionNumber: z.coerce.number().int().min(1).nullable().optional(),
  concurrencyLimit: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  rampUpSeconds: z.coerce.number().int().min(1).max(86_400).nullable().optional(),
  autoMaxConcurrency: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  failFast: z.coerce.boolean().optional().default(false),
  maxFailures: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  sourceJson: z.unknown().optional().default({}),
  urlFiles: z
    .array(
      z.object({
        url: z.string().min(1),
        name: z.string().optional(),
        id: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
})

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const url = new URL(req.url)
  let qp: z.infer<typeof getBatchesQuerySchema>
  try {
    qp = getBatchesQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  const whereBase =
    qp.q && qp.q.length
      ? {
          OR: [
            { publicId: { contains: qp.q } },
            { name: { contains: qp.q } },
            { workflow: { publicId: { contains: qp.q } } },
            { workflow: { name: { contains: qp.q } } },
          ],
        }
      : undefined
  const whereParts: Prisma.BatchWhereInput[] = []
  const visibilityWhere = getBatchesListVisibilityWhere(viewerAuth)
  if (visibilityWhere) whereParts.push(visibilityWhere)
  if (whereBase) whereParts.push(whereBase)
  const whereScoped = whereParts.length ? { AND: whereParts } : undefined
  const whereWithStatus = qp.status
    ? whereScoped
      ? { ...whereScoped, status: qp.status }
      : { status: qp.status }
    : whereScoped
  const orderBy = qp.sort === "CREATED_ASC" ? [{ createdAt: "asc" as const }] : [{ createdAt: "desc" as const }]

  const total = await prisma.batch.count({ where: whereWithStatus })
  const batches = await prisma.batch.findMany({
    where: whereWithStatus,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      status: true,
      workflowId: true,
      workflow: { select: { name: true, publicId: true } },
      pinnedWorkflowVersion: { select: { version: true } },
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

  // Aggregate job status counts for the page in one query (for richer list UI).
  const internalBatchIds = batches.map((b) => b.id).filter(Boolean)
  const jobsByBatchStatus =
    internalBatchIds.length > 0
      ? await prisma.jobRun.groupBy({
          by: ["batchId", "status"],
          where: { batchId: { in: internalBatchIds } },
          _count: { _all: true },
        })
      : []
  const jobsByBatchId = new Map<string, Record<JobRunStatusKey, number>>()
  for (const row of jobsByBatchStatus) {
    const batchId = String(row.batchId)
    const statusKeyRaw = String(row.status)
    const n = Number(row._count?._all ?? 0) || 0
    const cur = jobsByBatchId.get(batchId) ?? emptyJobsByStatus()
    // Only keep known statuses; ignore unexpected keys to avoid breaking clients.
    if ((JOB_RUN_STATUS_KEYS as readonly string[]).includes(statusKeyRaw)) {
      jobsByBatchId.set(batchId, { ...cur, [statusKeyRaw as JobRunStatusKey]: n })
    } else {
      jobsByBatchId.set(batchId, cur)
    }
  }

  return ok({
    total,
    batches: batches.map((b) => ({
      id: b.publicId,
      publicId: b.publicId,
      publicNumber: b.publicNumber,
      name: b.name,
      status: b.status,
      workflowId: b.workflow?.publicId ?? null,
      workflowName: b.workflow?.name ?? "—",
      pinnedWorkflowVersionNumber: b.pinnedWorkflowVersion?.version ?? null,
      concurrencyLimit: typeof b.concurrencyLimit === "number" ? b.concurrencyLimit : null,
      rampUpSeconds: typeof b.rampUpSeconds === "number" ? b.rampUpSeconds : null,
      autoMaxConcurrency: typeof b.autoMaxConcurrency === "number" ? b.autoMaxConcurrency : null,
      failFast: Boolean(b.failFast),
      maxFailures: typeof b.maxFailures === "number" ? b.maxFailures : null,
      urlFilesCount: (() => {
        try {
          const parsed = JSON.parse(String(b.urlFilesJson ?? "[]"))
          return Array.isArray(parsed) ? parsed.length : 0
        } catch {
          return 0
        }
      })(),
      provenance: (() => {
        try {
          const raw = JSON.parse(String(b.sourceJson ?? "{}"))
          if (!isRecord(raw)) return null
          const pick = (k: string) => {
            const v = raw[k]
            if (v == null) return null
            const s = String(v).trim()
            return s ? s.slice(0, 200) : null
          }
          return {
            source: pick("source"),
            owner: pick("owner"),
            ticket: pick("ticket"),
            dataset: pick("dataset"),
          }
        } catch {
          return null
        }
      })(),
      createdAt: b.createdAt,
      startedAt: b.startedAt,
      finishedAt: b.finishedAt,
      jobsTotal: b._count.jobRuns,
      jobsByStatus: jobsByBatchId.get(b.id) ?? emptyJobsByStatus(),
    })),
  })
})

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  return await runIdempotentOperation({
    req,
    action: "BATCH_CREATE",
    scope: "batches:create",
    targetType: "batch",
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      let body: z.infer<typeof createBatchSchema>
      try {
        body = createBatchSchema.parse(await req.json())
      } catch (e) {
        if (e instanceof z.ZodError) return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
        throw e
      }

      const workflowPublicId = String(body.workflowId || "")
        .trim()
        .toLowerCase()
      const workflow =
        (await prisma.workflow.findFirst({
          where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
        })) ?? (await prisma.workflow.findFirst({ where: getWorkflowFindFirstWhereById(viewerAuth, body.workflowId) }))
      if (!workflow) return { status: 404, body: { code: "WORKFLOW_NOT_FOUND" } }

      let pinnedWorkflowVersionId: string | null = null
      if (body.pinnedWorkflowVersionNumber != null) {
        const ver = body.pinnedWorkflowVersionNumber
        const row = await prisma.workflowVersion.findUnique({
          where: { workflowId_version: { workflowId: workflow.id, version: ver } },
          select: { id: true },
        })
        if (!row) {
          return {
            status: 422,
            body: {
              code: "INVALID_PINNED_WORKFLOW_VERSION",
              issues: [
                {
                  path: "/pinnedWorkflowVersionNumber",
                  keyword: "not_found",
                  params: { version: ver },
                },
              ],
            },
          }
        }
        pinnedWorkflowVersionId = row.id
      }

      // Validate urlFiles against the workflow version snapshot (best-effort; aligns with /api/jobs).
      let version = pinnedWorkflowVersionId
        ? await prisma.workflowVersion.findUnique({
            where: { id: pinnedWorkflowVersionId },
            select: { id: true, version: true, snapshotJson: true, createdAt: true },
          })
        : await getLatestWorkflowVersion(workflow.id)
      if (!version) {
        return {
          status: 409,
          body: { code: "WORKFLOW_VERSION_REQUIRED", meta: { workflowId: workflow.publicId } },
        }
      }
      const snapshot = workflowSnapshotSchema.parse(JSON.parse(version?.snapshotJson || "{}"))
      const specParsed = parseWorkflowInputSpecWithOpts(snapshot.inputSpec ?? null, {
        reservedKeys: snapshot.reservedInitialInputKeys,
      })
      if (snapshot.inputSpec && !specParsed.spec) {
        return {
          status: 500,
          body: { code: "WORKFLOW_INPUT_SPEC_INVALID", meta: { field: "inputSpec" } },
        }
      }
      const inputSpec = specParsed.spec
      const urlFiles = normalizeUrlFilesForStorage(body.urlFiles)
      if (inputSpec?.filesInput?.urlFiles) {
        const enabled = inputSpec.filesInput.urlFiles.enabled !== false
        if (!enabled && urlFiles.length) {
          const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
          return { status: 422, body: { code: "INVALID_INPUT_FILES", issues } }
        }
        if (
          typeof inputSpec.filesInput.urlFiles.maxItems === "number" &&
          urlFiles.length > inputSpec.filesInput.urlFiles.maxItems
        ) {
          const issues: ApiIssue[] = [
            {
              path: "/urlFiles",
              keyword: "maxItems",
              params: { limit: inputSpec.filesInput.urlFiles.maxItems },
            },
          ]
          return {
            status: 422,
            body: { code: "INVALID_INPUT_FILES", issues, meta: { maxItems: inputSpec.filesInput.urlFiles.maxItems } },
          }
        }
      } else if (urlFiles.length) {
        const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "not_supported", params: { field: "urlFiles" } }]
        return { status: 422, body: { code: "INVALID_INPUT_FILES", issues } }
      }

      const source = isRecord(body.sourceJson) ? body.sourceJson : { value: body.sourceJson }
      const pub = await allocatePublicId(prisma, "batch")
      const data: any = {
        id: crypto.randomUUID(),
        publicId: pub.publicId,
        publicNumber: pub.publicNumber,
        name: body.name?.trim() ? body.name.trim() : null,
        workflowId: workflow.id,
        ...makeCreateAudit(auth),
        status: "CREATED",
        pinnedWorkflowVersionId,
        concurrencyLimit: body.concurrencyLimit == null ? null : Math.floor(body.concurrencyLimit),
        rampUpSeconds: body.rampUpSeconds == null ? null : Math.floor(body.rampUpSeconds),
        autoMaxConcurrency: body.autoMaxConcurrency == null ? null : Math.floor(body.autoMaxConcurrency),
        failFast: Boolean(body.failFast),
        maxFailures: body.maxFailures == null ? null : Math.floor(body.maxFailures),
        sourceJson: JSON.stringify(source ?? {}),
        urlFilesJson: JSON.stringify(urlFiles),
      }
      const batch = await prisma.batch.create({
        data,
        // Avoid leaking internal UUIDs.
        select: { publicId: true, publicNumber: true },
      })

      return {
        status: 201,
        headers: { Location: `/api/batches/${batch.publicId}` },
        body: { batch: { ...batch, id: batch.publicId }, operationId },
      }
    },
  })
})

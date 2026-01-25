import crypto from "node:crypto"
import { z } from "zod"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { INPUT_DOWNLOAD_MAX_BYTES } from "@/lib/server/maia/config"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { sanitizeFilename, type JobInputFile } from "@/lib/server/maia/job-files"
import { ensureBlobFromBuffer } from "@/lib/server/maia/input-blobs"
import { findReservedKeysInRecord, parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import { validateWithJsonSchema } from "@/lib/server/maia/jsonschema"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { allocatePublicId } from "@/lib/server/public-ids"
import { isRecord } from "@/lib/shared/lang/is-record"
import type { ApiIssue } from "@/lib/shared/http/types"
import { requireRequestAuth } from "@/lib/server/authz"
import { makeCreateAudit } from "@/lib/server/audit/write"
import { getBatchFindFirstWhereByPublicId } from "@/lib/server/scopes/batches-scope"
import { getJobRunsListVisibilityWhere } from "@/lib/server/scopes/jobs-scope"
import { getScheduleFindFirstWhereByPublicId } from "@/lib/server/scopes/schedules-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { getWorkflowFindFirstWhereById, getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"

export const runtime = "nodejs"

const getJobsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["QUEUED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
  scheduleId: z.string().trim().min(1).optional(),
  batchId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

const createJobSchema = z.object({
  workflowId: z.string().min(1),
  inputJson: z.unknown().default({}),
  pinnedWorkflowVersionNumber: z.number().int().positive().optional(),
  start: z.boolean().optional().default(true),
})

const urlFileSchema = z.object({
  url: z.string().min(1),
  name: z.string().optional(),
  id: z.string().optional(),
})

function invalidInput422(params: { code: string; issues?: ApiIssue[]; meta?: Record<string, unknown> }) {
  return { status: 422, body: { code: params.code, issues: params.issues ?? [], meta: params.meta } }
}

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const url = new URL(req.url)
  let qp: z.infer<typeof getJobsQuerySchema>
  try {
    qp = getJobsQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      scheduleId: url.searchParams.get("scheduleId") ?? undefined,
      batchId: url.searchParams.get("batchId") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  const andParts: Prisma.JobRunWhereInput[] = []
  const visibilityWhere = getJobRunsListVisibilityWhere(viewerAuth)
  if (visibilityWhere) andParts.push(visibilityWhere)
  if (qp.scheduleId) {
    const schedulePublicId = String(qp.scheduleId || "")
      .trim()
      .toLowerCase()
    const s = await prisma.schedule.findFirst({
      where: getScheduleFindFirstWhereByPublicId(viewerAuth, schedulePublicId),
      select: { id: true },
    })
    if (!s) return ok({ total: 0, jobs: [] })
    andParts.push({ scheduleId: s.id })
  }
  if (qp.batchId) {
    const batchPublicId = String(qp.batchId || "")
      .trim()
      .toLowerCase()
    const b = await prisma.batch.findFirst({
      where: getBatchFindFirstWhereByPublicId(viewerAuth, batchPublicId),
      select: { id: true },
    })
    if (!b) return ok({ total: 0, jobs: [] })
    andParts.push({ batchId: b.id })
  }
  if (qp.q && qp.q.length) {
    andParts.push({
      OR: [
        { publicId: { contains: qp.q } },
        { run: { publicId: { contains: qp.q } } },
        { workflow: { publicId: { contains: qp.q } } },
        { workflow: { name: { contains: qp.q } } },
      ],
    })
  }
  if (qp.status) andParts.push({ status: qp.status })

  const whereWithStatus = andParts.length ? { AND: andParts } : undefined
  const orderBy = qp.sort === "CREATED_ASC" ? [{ queuedAt: "asc" as const }] : [{ queuedAt: "desc" as const }]

  const total = await prisma.jobRun.count({ where: whereWithStatus })
  const jobs = await prisma.jobRun.findMany({
    where: whereWithStatus,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      status: true,
      cancelRequestedAt: true,
      cancelRequestedReason: true,
      workflowId: true,
      workflow: { select: { name: true, publicId: true } },
      scheduleId: true,
      schedule: { select: { name: true, publicId: true } },
      batchId: true,
      batch: { select: { name: true, publicId: true } },
      scheduledFor: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
      claimedBy: true,
      claimedAt: true,
      leaseExpiresAt: true,
      attemptCount: true,
      maxAttempts: true,
      nextAttemptAt: true,
      runId: true,
      run: { select: { publicId: true, status: true, cancelRequestedAt: true } },
      lastErrorCode: true,
      lastErrorMessage: true,
      lastErrorMetaJson: true,
      lastErrorAt: true,
    },
  })

  return ok({
    total,
    jobs: jobs.map((j) => ({
      id: j.publicId,
      publicId: j.publicId,
      publicNumber: j.publicNumber,
      status: j.status,
      cancelRequestedAt: j.cancelRequestedAt ?? null,
      cancelRequestedReason: j.cancelRequestedReason ?? null,
      workflowId: j.workflow?.publicId ?? null,
      workflowName: j.workflow?.name ?? "—",
      scheduleId: j.schedule?.publicId ?? null,
      scheduleName: j.schedule?.name ?? null,
      batchId: j.batch?.publicId ?? null,
      batchName: j.batch?.name ?? null,
      scheduledFor: j.scheduledFor,
      queuedAt: j.queuedAt,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      claimedBy: j.claimedBy,
      claimedAt: j.claimedAt,
      leaseExpiresAt: j.leaseExpiresAt,
      attemptCount: j.attemptCount,
      maxAttempts: j.maxAttempts,
      nextAttemptAt: j.nextAttemptAt,
      runId: j.run?.publicId ?? null,
      runStatus: j.run?.status ?? null,
      runCancelRequestedAt: j.run?.cancelRequestedAt ?? null,
      lastErrorCode: j.lastErrorCode ?? null,
      lastErrorMessage: j.lastErrorMessage ?? null,
      lastErrorMetaJson: j.lastErrorMetaJson ?? null,
      lastErrorAt: j.lastErrorAt ?? null,
    })),
  })
})

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  return await runIdempotentOperation({
    req,
    action: "JOB_CREATE",
    scope: "jobs:create",
    targetType: "job",
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      let workflowId = ""
      let inputJson: unknown = {}
      let start = true
      let pinnedWorkflowVersionNumber: number | null = null
      let uploadFiles: File[] = []
      let urlFiles: Array<z.infer<typeof urlFileSchema>> = []

      const ct = req.headers.get("content-type") || ""
      if (ct.includes("multipart/form-data")) {
        const fd = await req.formData()
        workflowId = String(fd.get("workflowId") ?? "")
        const verStr = fd.get("pinnedWorkflowVersionNumber")
        if (typeof verStr === "string" && verStr.trim()) {
          const n = Number(verStr)
          if (!Number.isInteger(n) || n <= 0) {
            return { status: 400, body: { code: "INVALID_QUERY", meta: { field: "pinnedWorkflowVersionNumber" } } }
          }
          pinnedWorkflowVersionNumber = n
        }
        const initialInputStr = fd.get("initialInput")
        const inputJsonStr = fd.get("inputJson")
        const raw =
          typeof initialInputStr === "string" ? initialInputStr : typeof inputJsonStr === "string" ? inputJsonStr : "{}"
        try {
          inputJson = JSON.parse(raw || "{}")
        } catch (e) {
          return {
            status: 400,
            body: { code: "INVALID_JSON", meta: { field: "inputJson" } },
          }
        }
        const startStr = fd.get("start")
        if (typeof startStr === "string" && startStr.trim()) start = startStr === "true" || startStr === "1"
        const urlFilesStr = fd.get("urlFiles")
        if (typeof urlFilesStr === "string" && urlFilesStr.trim()) {
          try {
            urlFiles = z.array(urlFileSchema).parse(JSON.parse(urlFilesStr))
          } catch (e) {
            return {
              status: 400,
              body: { code: "INVALID_URL_FILES", meta: { field: "urlFiles" } },
            }
          }
        }
        uploadFiles = fd.getAll("files").filter((x): x is File => x instanceof File)
      } else {
        let body: z.infer<typeof createJobSchema>
        try {
          body = createJobSchema.parse(await req.json())
        } catch (e) {
          if (e instanceof z.ZodError) return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
          throw e
        }
        workflowId = body.workflowId
        inputJson = body.inputJson
        start = body.start ?? true
        pinnedWorkflowVersionNumber =
          typeof body.pinnedWorkflowVersionNumber === "number" ? body.pinnedWorkflowVersionNumber : null
      }

      const workflowPublicId = String(workflowId || "")
        .trim()
        .toLowerCase()
      const workflow =
        (await prisma.workflow.findFirst({
          where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
        })) ?? (await prisma.workflow.findFirst({ where: getWorkflowFindFirstWhereById(viewerAuth, workflowId) }))
      if (!workflow) return { status: 404, body: { code: "WORKFLOW_NOT_FOUND" } }

      // Back-compat: if no versions exist (legacy data), synthesize v1 from current workflow tables.
      let latest = await getLatestWorkflowVersion(workflow.id)
      if (!latest) {
        const steps = await prisma.workflowStep.findMany({
          where: { workflowId: workflow.id },
          orderBy: [{ key: "asc" }],
        })
        const deps = await prisma.workflowStepDep.findMany({ where: { workflowId: workflow.id } })
        const depMap = new Map<string, string[]>()
        for (const d of deps) {
          const arr = depMap.get(d.stepId) ?? []
          arr.push(d.dependsOnStepId)
          depMap.set(d.stepId, arr)
        }
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
            stepKey: s.key,
            name: s.name,
            scriptEsm: s.scriptEsm,
            timeoutMs: s.timeoutMs,
            deps: depMap.get(s.key) ?? [],
          })),
        })
        latest = await getLatestWorkflowVersion(workflow.id)
      }

      const selectedVersion = pinnedWorkflowVersionNumber
        ? await prisma.workflowVersion.findFirst({
            where: { workflowId: workflow.id, version: pinnedWorkflowVersionNumber },
            select: { id: true, version: true, snapshotJson: true },
          })
        : latest
      if (pinnedWorkflowVersionNumber && !selectedVersion) {
        return {
          status: 404,
          body: {
            code: "WORKFLOW_VERSION_NOT_FOUND",
            meta: { workflowId: workflow.publicId, version: pinnedWorkflowVersionNumber },
          },
        }
      }

      const snapshot = workflowSnapshotSchema.parse(JSON.parse(selectedVersion?.snapshotJson || "{}"))

      // If workflow declares an input spec (as of this version), enforce it here (schema contract).
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

      let normalized = isRecord(inputJson) ? inputJson : { value: inputJson }

      // Reject user-supplied reserved keys (system-managed / context-reserved).
      if (isRecord(normalized)) {
        const reserved = findReservedKeysInRecord(normalized, snapshot.reservedInitialInputKeys)
        if (reserved.length) {
          return invalidInput422({
            code: "INVALID_INITIAL_INPUT",
            issues: reserved.map((field) => ({
              path: `/${field}`,
              keyword: "reserved",
              params: { field },
            })),
          })
        }
      }

      if (inputSpec) {
        // Contract: inputJson must be an object when inputSpec is present.
        if (!isRecord(inputJson)) {
          return invalidInput422({
            code: "INVALID_INITIAL_INPUT",
            issues: [{ path: "/", keyword: "type", params: { type: "object" } }],
          })
        }

        const v = validateWithJsonSchema({ schema: inputSpec.paramsSchema, data: inputJson })
        if (!v.ok) {
          return invalidInput422({
            code: "INVALID_INITIAL_INPUT",
            issues: v.issues,
          })
        }

        // File constraints (validated against the separate Files tab inputs).
        const fi = inputSpec.fileInputs
        if (fi?.urlFiles) {
          const enabled = fi.urlFiles.enabled !== false
          if (!enabled && urlFiles.length) {
            return invalidInput422({
              code: "INVALID_INPUT_FILES",
              issues: [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }],
            })
          }
          if (fi.urlFiles.required && urlFiles.length === 0) {
            return invalidInput422({
              code: "INVALID_INPUT_FILES",
              issues: [{ path: "/urlFiles", keyword: "required", params: { missingProperty: "urlFiles" } }],
            })
          }
          if (typeof fi.urlFiles.maxItems === "number" && urlFiles.length > fi.urlFiles.maxItems) {
            return invalidInput422({
              code: "INVALID_INPUT_FILES",
              issues: [
                {
                  path: "/urlFiles",
                  keyword: "maxItems",
                  params: { limit: fi.urlFiles.maxItems },
                },
              ],
              meta: { maxItems: fi.urlFiles.maxItems },
            })
          }
        }

        if (fi?.uploads) {
          const enabled = fi.uploads.enabled !== false
          if (!enabled && uploadFiles.length) {
            return invalidInput422({
              code: "INVALID_INPUT_FILES",
              issues: [{ path: "/uploads", keyword: "disabled", params: { field: "uploads" } }],
            })
          }
          if (fi.uploads.required && uploadFiles.length === 0) {
            return invalidInput422({
              code: "INVALID_INPUT_FILES",
              issues: [{ path: "/uploads", keyword: "required", params: { missingProperty: "uploads" } }],
            })
          }
          if (typeof fi.uploads.maxItems === "number" && uploadFiles.length > fi.uploads.maxItems) {
            return invalidInput422({
              code: "INVALID_INPUT_FILES",
              issues: [
                {
                  path: "/uploads",
                  keyword: "maxItems",
                  params: { limit: fi.uploads.maxItems },
                },
              ],
              meta: { maxItems: fi.uploads.maxItems },
            })
          }
          if (fi.uploads.acceptMime?.length) {
            for (const f of uploadFiles) {
              const mime = typeof f.type === "string" ? String(f.type) : ""
              if (!mime) continue
              if (!fi.uploads.acceptMime.includes(mime)) {
                return invalidInput422({
                  code: "INVALID_INPUT_FILES",
                  issues: [
                    {
                      path: "/uploads",
                      keyword: "acceptMime",
                      params: { mime, accept: fi.uploads.acceptMime },
                    },
                  ],
                  meta: { mime, accept: fi.uploads.acceptMime },
                })
              }
            }
          }
        }
      }

      const jobId = crypto.randomUUID()
      const pub = await allocatePublicId(prisma, "job")

      // Attach files metadata: URL files (engine downloads) + uploaded files (already ready).
      if (!isRecord(normalized)) normalized = { value: normalized }
      const filesArr: JobInputFile[] = Array.isArray(normalized.files) ? normalized.files : []

      for (const uf of urlFiles) {
        const id = uf.id ?? crypto.randomUUID()
        const name = sanitizeFilename(
          uf.name ??
            (() => {
              try {
                const u = new URL(uf.url)
                const seg = u.pathname.split("/").filter(Boolean).pop()
                return seg ? decodeURIComponent(seg) : "download"
              } catch {
                return "download"
              }
            })(),
        )
        filesArr.push({ id, name, source: "url", url: uf.url, status: "fetching" })
      }

      const inputFileRows: Array<Prisma.InputFileCreateManyInput> = []

      for (const f of uploadFiles) {
        if (typeof f.size === "number" && f.size > INPUT_DOWNLOAD_MAX_BYTES) {
          return {
            status: 413,
            body: { code: "FILE_TOO_LARGE", meta: { name: f.name, maxBytes: INPUT_DOWNLOAD_MAX_BYTES } },
          }
        }
        const name = sanitizeFilename(f.name || "file")
        const buf = Buffer.from(await f.arrayBuffer())
        const blob = await ensureBlobFromBuffer({ buf, mime: f.type || null })
        const id = crypto.randomUUID()
        filesArr.push({
          id,
          name,
          source: "upload",
          status: "ready",
          // path is run-scoped; will be materialized when creating the Run.
          path: undefined,
          sizeBytes: blob.sizeBytes,
          sha256: blob.sha256,
          mime: blob.mime ?? undefined,
        })

        inputFileRows.push({
          id,
          jobRunId: jobId,
          source: "UPLOAD",
          status: "READY",
          name,
          url: null,
          error: null,
          blobId: blob.id,
          sha256: blob.sha256,
          sizeBytes: blob.sizeBytes,
          mime: blob.mime ?? null,
        })
      }

      if (filesArr.length) normalized.files = filesArr

      // Add URL files as InputFile rows (FETCHING, no blob yet).
      for (const uf of urlFiles) {
        const id = uf.id ?? crypto.randomUUID()
        const name = sanitizeFilename(
          uf.name ??
            (() => {
              try {
                const u = new URL(uf.url)
                const seg = u.pathname.split("/").filter(Boolean).pop()
                return seg ? decodeURIComponent(seg) : "download"
              } catch {
                return "download"
              }
            })(),
        )
        inputFileRows.push({
          id,
          jobRunId: jobId,
          source: "URL",
          status: "FETCHING",
          name,
          url: uf.url,
          error: null,
          blobId: null,
          sha256: null,
          sizeBytes: null,
          mime: null,
        })
      }

      const job = await prisma.$transaction(async (tx) => {
        const created = await tx.jobRun.create({
          data: {
            id: jobId,
            publicId: pub.publicId,
            publicNumber: pub.publicNumber,
            status: start ? "QUEUED" : "PAUSED",
            workflowId: workflow.id,
            pinnedWorkflowVersionId: selectedVersion?.id ?? null,
            ...makeCreateAudit(auth),
            requestedByUserId: auth.userId,
            inputJson: JSON.stringify(normalized ?? {}),
            nextAttemptAt: null,
          },
          // Avoid leaking internal UUIDs.
          select: { publicId: true, publicNumber: true, status: true, queuedAt: true },
        })

        if (inputFileRows.length) {
          await tx.inputFile.createMany({ data: inputFileRows })
        }
        return created
      })

      // kick engine
      const eng = await ensureEngineRunning()
      void eng.tick({ priority: "low", reason: "jobs:create" })

      return {
        status: 201,
        headers: { Location: `/api/jobs/${job.publicId}` },
        body: {
          job: { ...job, id: job.publicId },
          operationId,
        },
      }
    },
  })
})

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
import { getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
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
import { listJobs, listJobsQuerySchema } from "@/lib/server/services/jobs/list-jobs"

export const runtime = "nodejs"

const getJobsQuerySchema = listJobsQuerySchema

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

  return ok(await listJobs({ viewerAuth, query: qp }))
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

      const latest = await getLatestWorkflowVersion(workflow.id)
      if (!latest && pinnedWorkflowVersionNumber == null) {
        return {
          status: 409,
          body: { code: "WORKFLOW_VERSION_REQUIRED", meta: { workflowId: workflow.publicId } },
        }
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
        const fi = inputSpec.filesInput
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

        if (fi?.uploadFiles) {
          const enabled = fi.uploadFiles.enabled !== false
          if (!enabled && uploadFiles.length) {
            return invalidInput422({
              code: "INVALID_INPUT_FILES",
              issues: [{ path: "/uploadFiles", keyword: "disabled", params: { field: "uploadFiles" } }],
            })
          }
          if (fi.uploadFiles.required && uploadFiles.length === 0) {
            return invalidInput422({
              code: "INVALID_INPUT_FILES",
              issues: [{ path: "/uploadFiles", keyword: "required", params: { missingProperty: "uploadFiles" } }],
            })
          }
          if (typeof fi.uploadFiles.maxItems === "number" && uploadFiles.length > fi.uploadFiles.maxItems) {
            return invalidInput422({
              code: "INVALID_INPUT_FILES",
              issues: [
                {
                  path: "/uploadFiles",
                  keyword: "maxItems",
                  params: { limit: fi.uploadFiles.maxItems },
                },
              ],
              meta: { maxItems: fi.uploadFiles.maxItems },
            })
          }
          if (fi.uploadFiles.acceptMime?.length) {
            for (const f of uploadFiles) {
              const mime = typeof f.type === "string" ? String(f.type) : ""
              if (!mime) continue
              if (!fi.uploadFiles.acceptMime.includes(mime)) {
                return invalidInput422({
                  code: "INVALID_INPUT_FILES",
                  issues: [
                    {
                      path: "/uploadFiles",
                      keyword: "acceptMime",
                      params: { mime, accept: fi.uploadFiles.acceptMime },
                    },
                  ],
                  meta: { mime, accept: fi.uploadFiles.acceptMime },
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

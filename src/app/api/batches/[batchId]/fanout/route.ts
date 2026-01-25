import crypto from "node:crypto"
import { z } from "zod"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import type { ApiIssue } from "@/lib/shared/http/types"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { expandSeedToItems } from "@/lib/server/maia/batch-fanout"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { setOperationProgress, storeOperationResponse } from "@/lib/server/operations/operations"
import { allocatePublicNumberBlock, formatPublicId } from "@/lib/server/public-ids"
import { isRecord } from "@/lib/shared/lang/is-record"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import {
  findReservedInitialInputKeysInRecord,
  findReservedKeysInRecord,
  parseWorkflowInputSpecWithOpts,
} from "@/lib/shared/maia/input-spec"
import { validateWithJsonSchema } from "@/lib/server/maia/jsonschema"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { normalizeUrlFilesForStorage, parseStoredUrlFilesJson, toUrlInputFiles } from "@/lib/server/maia/url-files"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"

export const runtime = "nodejs"

const fanoutSchema = z.object({
  seedJson: z.unknown(),
  kind: z.enum(["auto"]).optional().default("auto"),
  maxItems: z.coerce.number().int().min(1).max(5000).optional().default(2000),
  start: z.boolean().optional().default(true),
  // Deterministic sharding: pick a subset of items by index % shardCount === shardIndex.
  shardCount: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  shardIndex: z.coerce.number().int().min(0).max(9_999).optional().default(0),
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

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  return await runIdempotentOperation({
    req,
    action: "BATCH_FANOUT",
    scope: `batches:${batchPublicId}:fanout`,
    targetType: "batch",
    targetId: batchPublicId,
    exec: async ({ operationId, operationInternalId }) => {
      const batch = await prisma.batch.findFirst({
        where: { publicId: batchPublicId, ...(isAdmin(auth) ? {} : { ownerUserId: auth.userId }) },
        select: {
          id: true,
          workflowId: true,
          pinnedWorkflowVersionId: true,
          urlFilesJson: true,
          startedAt: true,
          ownerUserId: true,
        },
      })
      if (!batch) return { status: 404, body: { code: "NOT_FOUND" } }

      const existingJobs = await prisma.jobRun.count({ where: { batchId: batch.id } })
      if (existingJobs > 0 || batch.startedAt) {
        // Fanout locks the batch (no further mutation / fanout).
        return { status: 409, body: { code: "BATCH_LOCKED" } }
      }

      let body: z.infer<typeof fanoutSchema>
      try {
        body = fanoutSchema.parse(await req.json())
      } catch (e) {
        if (e instanceof z.ZodError) return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
        throw e
      }

      const { items, truncated, kind } = expandSeedToItems({
        seed: body.seedJson,
        kind: body.kind,
        maxItems: body.maxItems,
      })
      const shardCount = Math.max(1, Math.floor(body.shardCount || 1))
      const shardIndex = Math.max(0, Math.floor(body.shardIndex || 0))
      if (shardIndex >= shardCount) {
        const issues: ApiIssue[] = [{ path: "/shardIndex", keyword: "exclusiveMaximum", params: { limit: shardCount } }]
        return { status: 422, body: { code: "INVALID_SHARD", issues } }
      }
      const shardedItems = shardCount === 1 ? items : items.filter((_, idx) => idx % shardCount === shardIndex)
      if (items.length === 0) {
        const issues: ApiIssue[] = [{ path: "/seedJson", keyword: "minItems", params: { limit: 1 } }]
        return {
          status: 422,
          body: { code: "EMPTY_ITEMS", issues },
        }
      }
      if (shardedItems.length === 0) {
        const issues: ApiIssue[] = [{ path: "/shardCount", keyword: "minItems", params: { limit: 1 } }]
        return { status: 422, body: { code: "EMPTY_ITEMS", issues } }
      }

      // Resolve workflow version snapshot for input validation and reproducibility (same logic as the async fanout worker).
      let pinnedWorkflowVersionId = batch.pinnedWorkflowVersionId
      let latest = pinnedWorkflowVersionId ? null : await getLatestWorkflowVersion(batch.workflowId)
      if (!pinnedWorkflowVersionId) {
        if (!latest) {
          // Back-compat: synthesize a version snapshot if none exist.
          const wf = await prisma.workflow.findUnique({
            where: { id: batch.workflowId },
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
            const steps = await prisma.workflowStep.findMany({
              where: { workflowId: wf.id },
              orderBy: [{ key: "asc" }],
            })
            const deps = await prisma.workflowStepDep.findMany({ where: { workflowId: wf.id } })
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
            latest = await getLatestWorkflowVersion(wf.id)
          }
        }
        pinnedWorkflowVersionId = latest?.id ?? null
      }

      // InputSpec validation (params + reserved `files` + fileInputs.urlFiles constraints).
      // urlFiles can be provided at fanout-time; otherwise use the stored batch value.
      const storedUrlFiles = parseStoredUrlFilesJson(batch.urlFilesJson)
      const effectiveUrlFiles =
        body.urlFiles !== undefined ? normalizeUrlFilesForStorage(body.urlFiles) : storedUrlFiles
      const urlInputFiles = toUrlInputFiles(effectiveUrlFiles)
      let inputSpec = null as ReturnType<typeof parseWorkflowInputSpecWithOpts>["spec"]
      let reservedInitialInputKeys: string[] = ["files"]
      if (pinnedWorkflowVersionId) {
        const ver = await prisma.workflowVersion.findUnique({
          where: { id: pinnedWorkflowVersionId },
          select: { snapshotJson: true },
        })
        const snapshot = workflowSnapshotSchema.parse(JSON.parse(ver?.snapshotJson || "{}"))
        reservedInitialInputKeys = Array.isArray(snapshot.reservedInitialInputKeys)
          ? snapshot.reservedInitialInputKeys
          : ["files"]
        const specParsed = parseWorkflowInputSpecWithOpts(snapshot.inputSpec ?? null, {
          reservedKeys: reservedInitialInputKeys,
        })
        if (snapshot.inputSpec && !specParsed.spec) {
          return {
            status: 500,
            body: { code: "WORKFLOW_INPUT_SPEC_INVALID", meta: { field: "inputSpec" } },
          }
        }
        inputSpec = specParsed.spec
      }
      if (inputSpec) {
        // urlFiles constraints (batch-level shared)
        if (inputSpec.fileInputs?.urlFiles) {
          const enabled = inputSpec.fileInputs.urlFiles.enabled !== false
          if (!enabled && urlInputFiles.length) {
            const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
            return { status: 422, body: { code: "INVALID_INPUT_FILES", issues } }
          }
          if (inputSpec.fileInputs.urlFiles.required && urlInputFiles.length === 0) {
            const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "required", params: { field: "urlFiles" } }]
            return { status: 422, body: { code: "INVALID_INPUT_FILES", issues } }
          }
          if (
            typeof inputSpec.fileInputs.urlFiles.maxItems === "number" &&
            effectiveUrlFiles.length > inputSpec.fileInputs.urlFiles.maxItems
          ) {
            const issues: ApiIssue[] = [
              {
                path: "/urlFiles",
                keyword: "maxItems",
                params: { limit: inputSpec.fileInputs.urlFiles.maxItems },
              },
            ]
            return {
              status: 422,
              body: { code: "INVALID_INPUT_FILES", issues, meta: { maxItems: inputSpec.fileInputs.urlFiles.maxItems } },
            }
          }
        } else if (urlInputFiles.length) {
          const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "not_supported", params: { field: "urlFiles" } }]
          return { status: 422, body: { code: "INVALID_INPUT_FILES", issues } }
        }

        // Validate each item params schema + reserved fields.
        for (let i = 0; i < shardedItems.length; i++) {
          const it = shardedItems[i]
          if (!isRecord(it)) {
            const issues: ApiIssue[] = [
              {
                path: "/seedJson",
                keyword: "type",
                params: { index: i },
              },
            ]
            return { status: 422, body: { code: "INVALID_INITIAL_INPUT", issues } }
          }
          const reserved = findReservedKeysInRecord(it, reservedInitialInputKeys)
          if (reserved.length) {
            const issues: ApiIssue[] = reserved.map((field) => ({
              path: `/seedJson/items/${i}/${field}`,
              keyword: "reserved",
              params: { field, index: i },
            }))
            return { status: 422, body: { code: "INVALID_INITIAL_INPUT", issues } }
          }
          const v = validateWithJsonSchema({ schema: inputSpec.paramsSchema, data: it })
          if (!v.ok) {
            const issues: ApiIssue[] = v.issues.map((iss) => ({
              ...iss,
              path: `/seedJson/items/${i}${iss.path === "/" ? "" : iss.path}`,
            }))
            return { status: 422, body: { code: "INVALID_INITIAL_INPUT", issues } }
          }
        }
      } else {
        // Even without inputSpec, still enforce reserved fields (system-managed / context-reserved).
        for (let i = 0; i < shardedItems.length; i++) {
          const it = shardedItems[i]
          if (!isRecord(it)) continue
          const reserved = findReservedKeysInRecord(it, ["files"])
          if (!reserved.length) continue
          const issues: ApiIssue[] = reserved.map((field) => ({
            path: `/seedJson/items/${i}/${field}`,
            keyword: "reserved",
            params: { field, index: i },
          }))
          return { status: 422, body: { code: "INVALID_INITIAL_INPUT", issues } }
        }
      }

      // Async: write jobs in chunks, update operation progress, then finalize stored result.
      void (async () => {
        const chunkSize = 200
        const total = shardedItems.length
        let created = 0
        const sampleJobIds: string[] = []
        try {
          await setOperationProgress({
            operationId: operationInternalId,
            current: 0,
            total,
            messageKey: "operations.progressMessages.enqueueingJobs",
            messageParams: { total },
          })

          const now = new Date()
          // Resolve and lock workflow version at fanout time:
          // - If pinned already, keep it.
          // - If not pinned, resolve latest and persist to batch so the batch is reproducible.
          // (Note: we already resolved pinnedWorkflowVersionId above for validation; reuse it here.)

          const nextBatchStatus = body.start ? "RUNNING" : "PAUSED"
          const startedAt = body.start ? now : null

          // Lock batch fields once at the start.
          await prisma.batch.update({
            where: { id: batch.id },
            data: {
              status: nextBatchStatus,
              startedAt,
              pinnedWorkflowVersionId,
              fanoutSeedJson: JSON.stringify(body.seedJson ?? {}),
              urlFilesJson: JSON.stringify(effectiveUrlFiles),
            },
            select: { id: true },
          })

          for (let i = 0; i < shardedItems.length; i += chunkSize) {
            const slice = shardedItems.slice(i, i + chunkSize)
            const startNo = await allocatePublicNumberBlock(prisma, "job", slice.length)
            const rows: Prisma.JobRunCreateManyInput[] = slice.map((it, idx) => {
              const normalized = isRecord(it) ? { ...it } : { value: it }
              // Attach batch-level shared URL input files (system-managed).
              if (urlInputFiles.length) {
                if (isRecord(normalized)) delete (normalized as Record<string, unknown>).files
                ;(normalized as Record<string, unknown>).files = urlInputFiles
              }
              const id = crypto.randomUUID()
              const publicNumber = startNo + idx
              const publicId = formatPublicId("job", publicNumber)
              if (sampleJobIds.length < 50) sampleJobIds.push(publicId)
              return {
                id,
                publicId,
                publicNumber,
                status: body.start ? "QUEUED" : "PAUSED",
                workflowId: batch.workflowId,
                pinnedWorkflowVersionId,
                batchId: batch.id,
                ownerUserId: batch.ownerUserId ?? auth.userId,
                createdByUserId: auth.userId,
                updatedByUserId: auth.userId,
                triggeredByUserId: auth.userId,
                requestedByUserId: batch.ownerUserId ?? auth.userId,
                inputJson: JSON.stringify(normalized ?? {}),
                nextAttemptAt: null,
              }
            })
            const res = await prisma.jobRun.createMany({ data: rows })
            created += Number(res?.count ?? rows.length)
            await setOperationProgress({
              operationId: operationInternalId,
              current: Math.min(i + slice.length, total),
              total,
              messageKey: "operations.progressMessages.createdJobs",
              messageParams: { created, total },
            })
          }

          const eng = await ensureEngineRunning()
          void eng.tick({ priority: "low", reason: "batches:fanout" })

          await storeOperationResponse({
            operationId: operationInternalId,
            reply: {
              status: 200,
              body: {
                ok: true,
                kind,
                truncated,
                expanded: items.length,
                shardCount,
                shardIndex,
                sharded: total,
                created,
                jobIds: sampleJobIds,
                operationId,
              },
            },
          })
        } catch (e) {
          await storeOperationResponse({
            operationId: operationInternalId,
            reply: {
              status: 500,
              body: {
                code: "FANOUT_FAILED",
              },
            },
            error: e,
          })
        }
      })()

      return {
        status: 202,
        body: {
          ok: true,
          operationId,
          kind,
          truncated,
          expanded: items.length,
          shardCount,
          shardIndex,
          sharded: shardedItems.length,
        },
      }
    },
  })
})

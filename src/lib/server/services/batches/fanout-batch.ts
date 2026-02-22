import "server-only"

import crypto from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import type { RequestAuthContext } from "@/lib/server/authz"
import { isAdmin } from "@/lib/server/authz"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { expandSeedToItems } from "@/lib/server/maia/batch-fanout"
import { setOperationProgress, storeOperationResponse } from "@/lib/server/operations/operations"
import { allocatePublicNumberBlock, formatPublicId } from "@/lib/server/public-ids"
import { isRecord } from "@/lib/shared/lang/is-record"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeRetryPolicyJson } from "@/lib/server/maia/workflow-snapshot-normalize"
import { findReservedKeysInRecord, parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import { validateWithJsonSchema } from "@/lib/server/maia/jsonschema"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { normalizeUrlFilesForStorage, parseStoredUrlFilesJson, toUrlInputFiles } from "@/lib/server/maia/url-files"
import type { ApiIssue } from "@/lib/shared/http/types"

export const fanoutBatchSchema = z.object({
  seedJson: z.unknown(),
  kind: z.enum(["auto"]).optional().default("auto"),
  maxItems: z.coerce.number().int().min(1).max(5000).optional().default(2000),
  start: z.boolean().optional().default(true),
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

export async function startBatchFanout(params: {
  auth: RequestAuthContext
  batchId: string
  operationId?: string
  operationInternalId?: string
  body: z.infer<typeof fanoutBatchSchema>
}) {
  const batchPublicId = String(params.batchId || "")
    .trim()
    .toLowerCase()
  const batch = await prisma.batch.findFirst({
    where: { publicId: batchPublicId, ...(isAdmin(params.auth) ? {} : { ownerUserId: params.auth.userId }) },
    select: {
      id: true,
      workflowId: true,
      pinnedWorkflowVersionId: true,
      urlFilesJson: true,
      startedAt: true,
      ownerUserId: true,
    },
  })
  if (!batch) return { ok: false as const, status: 404, code: "NOT_FOUND" as const }

  const existingJobs = await prisma.jobRun.count({ where: { batchId: batch.id } })
  if (existingJobs > 0 || batch.startedAt) return { ok: false as const, status: 409, code: "BATCH_LOCKED" as const }

  const { items, truncated, kind } = expandSeedToItems({
    seed: params.body.seedJson,
    kind: params.body.kind,
    maxItems: params.body.maxItems,
  })
  const shardCount = Math.max(1, Math.floor(params.body.shardCount || 1))
  const shardIndex = Math.max(0, Math.floor(params.body.shardIndex || 0))
  if (shardIndex >= shardCount) {
    const issues: ApiIssue[] = [{ path: "/shardIndex", keyword: "exclusiveMaximum", params: { limit: shardCount } }]
    return { ok: false as const, status: 422, code: "INVALID_SHARD" as const, issues }
  }
  const shardedItems = shardCount === 1 ? items : items.filter((_, idx) => idx % shardCount === shardIndex)
  if (items.length === 0) {
    const issues: ApiIssue[] = [{ path: "/seedJson", keyword: "minItems", params: { limit: 1 } }]
    return { ok: false as const, status: 422, code: "EMPTY_ITEMS" as const, issues }
  }
  if (shardedItems.length === 0) {
    const issues: ApiIssue[] = [{ path: "/shardCount", keyword: "minItems", params: { limit: 1 } }]
    return { ok: false as const, status: 422, code: "EMPTY_ITEMS" as const, issues }
  }

  let pinnedWorkflowVersionId = batch.pinnedWorkflowVersionId
  let latest = pinnedWorkflowVersionId ? null : await getLatestWorkflowVersion(batch.workflowId)
  if (!pinnedWorkflowVersionId) {
    if (!latest) {
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
          createdByUserId: params.auth.userId,
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
            retryPolicy: normalizeRetryPolicyJson(s.retryPolicyJson),
            deps: depMap.get(s.key) ?? [],
          })),
        })
        latest = await getLatestWorkflowVersion(wf.id)
      }
    }
    pinnedWorkflowVersionId = latest?.id ?? null
  }

  const storedUrlFiles = parseStoredUrlFilesJson(batch.urlFilesJson)
  const effectiveUrlFiles =
    params.body.urlFiles !== undefined ? normalizeUrlFilesForStorage(params.body.urlFiles) : storedUrlFiles
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
        ok: false as const,
        status: 500,
        code: "WORKFLOW_INPUT_SPEC_INVALID" as const,
        meta: { field: "inputSpec" },
      }
    }
    inputSpec = specParsed.spec
  }
  if (inputSpec) {
    if (inputSpec.filesInput?.urlFiles) {
      const enabled = inputSpec.filesInput.urlFiles.enabled !== false
      if (!enabled && urlInputFiles.length) {
        const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
        return { ok: false as const, status: 422, code: "INVALID_INPUT_FILES" as const, issues }
      }
      if (inputSpec.filesInput.urlFiles.required && urlInputFiles.length === 0) {
        const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "required", params: { field: "urlFiles" } }]
        return { ok: false as const, status: 422, code: "INVALID_INPUT_FILES" as const, issues }
      }
      if (
        typeof inputSpec.filesInput.urlFiles.maxItems === "number" &&
        effectiveUrlFiles.length > inputSpec.filesInput.urlFiles.maxItems
      ) {
        const issues: ApiIssue[] = [
          {
            path: "/urlFiles",
            keyword: "maxItems",
            params: { limit: inputSpec.filesInput.urlFiles.maxItems },
          },
        ]
        return {
          ok: false as const,
          status: 422,
          code: "INVALID_INPUT_FILES" as const,
          issues,
          meta: { maxItems: inputSpec.filesInput.urlFiles.maxItems },
        }
      }
    } else if (urlInputFiles.length) {
      const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "not_supported", params: { field: "urlFiles" } }]
      return { ok: false as const, status: 422, code: "INVALID_INPUT_FILES" as const, issues }
    }

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
        return { ok: false as const, status: 422, code: "INVALID_INITIAL_INPUT" as const, issues }
      }
      const reserved = findReservedKeysInRecord(it, reservedInitialInputKeys)
      if (reserved.length) {
        const issues: ApiIssue[] = reserved.map((field) => ({
          path: `/seedJson/items/${i}/${field}`,
          keyword: "reserved",
          params: { field, index: i },
        }))
        return { ok: false as const, status: 422, code: "INVALID_INITIAL_INPUT" as const, issues }
      }
      const v = validateWithJsonSchema({ schema: inputSpec.paramsSchema, data: it })
      if (!v.ok) {
        const issues: ApiIssue[] = v.issues.map((iss) => ({
          ...iss,
          path: `/seedJson/items/${i}${iss.path === "/" ? "" : iss.path}`,
        }))
        return { ok: false as const, status: 422, code: "INVALID_INITIAL_INPUT" as const, issues }
      }
    }
  } else {
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
      return { ok: false as const, status: 422, code: "INVALID_INITIAL_INPUT" as const, issues }
    }
  }

  void (async () => {
    const chunkSize = 200
    const total = shardedItems.length
    let created = 0
    const sampleJobIds: string[] = []
    try {
      if (params.operationInternalId) {
        await setOperationProgress({
          operationId: params.operationInternalId,
          current: 0,
          total,
          messageKey: "operations.progressMessages.enqueueingJobs",
          messageParams: { total },
        })
      }

      const now = new Date()
      const nextBatchStatus = params.body.start ? "RUNNING" : "PAUSED"
      const startedAt = params.body.start ? now : null
      await prisma.batch.update({
        where: { id: batch.id },
        data: {
          status: nextBatchStatus,
          startedAt,
          pinnedWorkflowVersionId,
          fanoutSeedJson: JSON.stringify(params.body.seedJson ?? {}),
          urlFilesJson: JSON.stringify(effectiveUrlFiles),
        },
        select: { id: true },
      })

      for (let i = 0; i < shardedItems.length; i += chunkSize) {
        const slice = shardedItems.slice(i, i + chunkSize)
        const startNo = await allocatePublicNumberBlock(prisma, "job", slice.length)
        const rows: Prisma.JobRunCreateManyInput[] = slice.map((it, idx) => {
          const normalized = isRecord(it) ? { ...it } : { value: it }
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
            status: params.body.start ? "QUEUED" : "PAUSED",
            workflowId: batch.workflowId,
            pinnedWorkflowVersionId,
            batchId: batch.id,
            ownerUserId: batch.ownerUserId ?? params.auth.userId,
            createdByUserId: params.auth.userId,
            updatedByUserId: params.auth.userId,
            triggeredByUserId: params.auth.userId,
            requestedByUserId: batch.ownerUserId ?? params.auth.userId,
            inputJson: JSON.stringify(normalized ?? {}),
            nextAttemptAt: null,
          }
        })
        const res = await prisma.jobRun.createMany({ data: rows })
        created += Number(res?.count ?? rows.length)
        if (params.operationInternalId) {
          await setOperationProgress({
            operationId: params.operationInternalId,
            current: Math.min(i + slice.length, total),
            total,
            messageKey: "operations.progressMessages.createdJobs",
            messageParams: { created, total },
          })
        }
      }

      const eng = await ensureEngineRunning()
      void eng.tick({ priority: "low", reason: "batches:fanout" })

      if (params.operationInternalId && params.operationId) {
        await storeOperationResponse({
          operationId: params.operationInternalId,
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
              operationId: params.operationId,
            },
          },
        })
      }
    } catch (e) {
      if (params.operationInternalId) {
        await storeOperationResponse({
          operationId: params.operationInternalId,
          reply: {
            status: 500,
            body: { code: "FANOUT_FAILED" },
          },
          error: e,
        })
      }
    }
  })()

  return {
    ok: true as const,
    status: 202,
    body: {
      ok: true,
      operationId: params.operationId ?? null,
      kind,
      truncated,
      expanded: items.length,
      shardCount,
      shardIndex,
      sharded: shardedItems.length,
    },
  }
}

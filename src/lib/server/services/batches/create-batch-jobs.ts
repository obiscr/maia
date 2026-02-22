import "server-only"

import crypto from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import type { RequestAuthContext } from "@/lib/server/authz"
import { isAdmin } from "@/lib/server/authz"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { setOperationProgress, storeOperationResponse } from "@/lib/server/operations/operations"
import { allocatePublicNumberBlock, formatPublicId } from "@/lib/server/public-ids"
import { isRecord } from "@/lib/shared/lang/is-record"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeRetryPolicyJson } from "@/lib/server/maia/workflow-snapshot-normalize"

export const createBatchJobsSchema = z.object({
  items: z.array(z.unknown()).min(1).max(5000),
  start: z.boolean().optional().default(true),
})

export async function createBatchJobs(params: {
  auth: RequestAuthContext
  batchId: string
  operationId?: string
  operationInternalId?: string
  body: z.infer<typeof createBatchJobsSchema>
}) {
  const batchPublicId = String(params.batchId || "")
    .trim()
    .toLowerCase()
  const batch = await prisma.batch.findFirst({
    where: { publicId: batchPublicId, ...(isAdmin(params.auth) ? {} : { ownerUserId: params.auth.userId }) },
    select: { id: true, workflowId: true, pinnedWorkflowVersionId: true, ownerUserId: true },
  })
  if (!batch) return { ok: false as const, status: 404, code: "NOT_FOUND" as const }

  const existingJobs = await prisma.jobRun.count({ where: { batchId: batch.id } })
  if (existingJobs > 0) return { ok: false as const, status: 409, code: "BATCH_LOCKED" as const }

  void (async () => {
    const chunkSize = 200
    const total = params.body.items.length
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
      let pinnedWorkflowVersionId = batch.pinnedWorkflowVersionId
      if (!pinnedWorkflowVersionId) {
        let latest = await getLatestWorkflowVersion(batch.workflowId)
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

      const nextBatchStatus = params.body.start ? "RUNNING" : "PAUSED"
      const startedAt = params.body.start ? now : null
      await prisma.batch.update({
        where: { id: batch.id },
        data: {
          status: nextBatchStatus,
          startedAt,
          pinnedWorkflowVersionId,
          fanoutSeedJson: JSON.stringify({ items: params.body.items }),
          updatedByUserId: params.auth.userId,
          triggeredByUserId: params.auth.userId,
        },
        select: { id: true },
      })

      for (let i = 0; i < params.body.items.length; i += chunkSize) {
        const slice = params.body.items.slice(i, i + chunkSize)
        const startNo = await allocatePublicNumberBlock(prisma, "job", slice.length)
        const rows: Prisma.JobRunCreateManyInput[] = slice.map((it, idx) => {
          const normalized = isRecord(it) ? it : { value: it }
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
      void eng.tick({ priority: "low", reason: "batches:jobs:create" })

      if (params.operationInternalId && params.operationId) {
        await storeOperationResponse({
          operationId: params.operationInternalId,
          reply: { status: 200, body: { ok: true, created, jobIds: sampleJobIds, operationId: params.operationId } },
        })
      }
    } catch (e) {
      if (params.operationInternalId) {
        await storeOperationResponse({
          operationId: params.operationInternalId,
          reply: { status: 500, body: { code: "BATCH_JOBS_CREATE_FAILED" } },
          error: e,
        })
      }
    }
  })()

  return {
    ok: true as const,
    status: 202,
    body: { ok: true, operationId: params.operationId ?? null, total: params.body.items.length },
  }
}

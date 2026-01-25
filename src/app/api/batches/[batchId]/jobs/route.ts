import crypto from "node:crypto"
import { z } from "zod"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { setOperationProgress, storeOperationResponse } from "@/lib/server/operations/operations"
import { allocatePublicNumberBlock, formatPublicId } from "@/lib/server/public-ids"
import { isRecord } from "@/lib/shared/lang/is-record"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"

export const runtime = "nodejs"

const createBatchJobsSchema = z.object({
  items: z.array(z.unknown()).min(1).max(5000),
  start: z.boolean().optional().default(true),
})

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const { batchId } = await ctx.params
  const batchPublicId = String(batchId || "")
    .trim()
    .toLowerCase()
  return await runIdempotentOperation({
    req,
    action: "BATCH_JOBS_CREATE",
    scope: `batches:${batchPublicId}:jobs:create`,
    targetType: "batch",
    targetId: batchPublicId,
    exec: async ({ operationId, operationInternalId }) => {
      const batch = await prisma.batch.findFirst({
        where: { publicId: batchPublicId, ...(isAdmin(auth) ? {} : { ownerUserId: auth.userId }) },
        select: { id: true, workflowId: true, pinnedWorkflowVersionId: true, ownerUserId: true },
      })
      if (!batch) return { status: 404, body: { code: "NOT_FOUND" } }

      const existingJobs = await prisma.jobRun.count({ where: { batchId: batch.id } })
      if (existingJobs > 0) {
        // Fanout locks the batch (no further enqueueing).
        return { status: 409, body: { code: "BATCH_LOCKED" } }
      }

      let body: z.infer<typeof createBatchJobsSchema>
      try {
        body = createBatchJobsSchema.parse(await req.json())
      } catch (e) {
        if (e instanceof z.ZodError) return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
        throw e
      }

      void (async () => {
        const chunkSize = 200
        const total = body.items.length
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
          // Resolve and lock workflow version at enqueue time (same as fanout route).
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

          const nextBatchStatus = body.start ? "RUNNING" : "PAUSED"
          const startedAt = body.start ? now : null

          // Lock batch fields once at the start.
          await prisma.batch.update({
            where: { id: batch.id },
            data: {
              status: nextBatchStatus,
              startedAt,
              pinnedWorkflowVersionId,
              fanoutSeedJson: JSON.stringify({ items: body.items }),
              updatedByUserId: auth.userId,
              triggeredByUserId: auth.userId,
            },
            select: { id: true },
          })

          for (let i = 0; i < body.items.length; i += chunkSize) {
            const slice = body.items.slice(i, i + chunkSize)
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
          void eng.tick({ priority: "low", reason: "batches:jobs:create" })

          await storeOperationResponse({
            operationId: operationInternalId,
            reply: { status: 200, body: { ok: true, created, jobIds: sampleJobIds, operationId } },
          })
        } catch (e) {
          await storeOperationResponse({
            operationId: operationInternalId,
            reply: {
              status: 500,
              body: { code: "BATCH_JOBS_CREATE_FAILED" },
            },
            error: e,
          })
        }
      })()

      return { status: 202, body: { ok: true, operationId, total: body.items.length } }
    },
  })
})

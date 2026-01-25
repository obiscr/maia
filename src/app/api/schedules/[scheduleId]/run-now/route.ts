import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { mark, withApiObservability } from "@/lib/server/observability"
import { computeNextRunAt, type ScheduleLike } from "@/lib/server/maia/scheduler"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { allocatePublicId } from "@/lib/server/public-ids"
import { mergeUrlInputFilesIntoInputJson, parseStoredUrlFilesJson, toUrlInputFiles } from "@/lib/server/maia/url-files"
import { requireRequestAuth } from "@/lib/server/authz"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import { getScheduleFindFirstWhereByPublicId } from "@/lib/server/scopes/schedules-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ scheduleId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { scheduleId } = await ctx.params
  const schedulePublicId = String(scheduleId || "")
    .trim()
    .toLowerCase()
  return await runIdempotentOperation({
    req,
    action: "SCHEDULE_RUN_NOW",
    scope: `schedules:${schedulePublicId}:run-now`,
    targetType: "schedule",
    targetId: schedulePublicId,
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      const now = new Date()

      try {
        const res = await prisma.$transaction(async (tx) => {
          const s = await tx.schedule.findFirst({
            where: getScheduleFindFirstWhereByPublicId(viewerAuth, schedulePublicId),
            select: {
              id: true,
              ownerUserId: true,
              enabled: true,
              workflowId: true,
              pinnedWorkflowVersionId: true,
              kind: true,
              cron: true,
              timezone: true,
              intervalMs: true,
              inputJson: true,
              urlFilesJson: true,
              nextRunAt: true,
              lastRunAt: true,
              createdAt: true,
            },
          })
          if (!s) return null

          const jobId = crypto.randomUUID()
          const pub = await allocatePublicId(tx, "job")

          // Merge schedule urlFiles into the job's initial input as system-managed `files[]`.
          const storedUrlFiles = parseStoredUrlFilesJson(s.urlFilesJson)
          const urlInputFiles = toUrlInputFiles(storedUrlFiles)
          const inputToWrite = mergeUrlInputFilesIntoInputJson({
            inputJson: typeof s.inputJson === "string" ? s.inputJson : "{}",
            urlInputFiles,
          })

          await tx.jobRun.create({
            data: {
              id: jobId,
              publicId: pub.publicId,
              publicNumber: pub.publicNumber,
              status: "QUEUED",
              workflowId: s.workflowId,
              pinnedWorkflowVersionId: s.pinnedWorkflowVersionId,
              scheduleId: s.id,
              ownerUserId: s.ownerUserId ?? auth.userId,
              createdByUserId: auth.userId,
              updatedByUserId: auth.userId,
              triggeredByUserId: auth.userId,
              requestedByUserId: s.ownerUserId ?? auth.userId,
              scheduledFor: now,
              inputJson: inputToWrite,
              nextAttemptAt: null,
            },
            select: { id: true },
          })

          // Treat run-now as an actual fire time (affects interval anchor and future cron computations).
          const nextRunAt = s.enabled
            ? computeNextRunAt(
                {
                  kind: s.kind,
                  cron: s.cron,
                  timezone: s.timezone,
                  intervalMs: s.intervalMs,
                  nextRunAt: null,
                  lastRunAt: now,
                  createdAt: s.createdAt,
                } satisfies ScheduleLike,
                now,
              )
            : null

          await tx.schedule.update({
            where: { id: s.id },
            data: { lastRunAt: now, nextRunAt, ...makeUpdateAudit(auth) },
            select: { id: true },
          })

          return { jobId, jobPublicId: pub.publicId }
        })

        if (!res) return { status: 404, body: { code: "NOT_FOUND" } }

        const eng = await ensureEngineRunning()
        mark("engine")
        void eng.tick()
        mark("engine.tick")

        return {
          status: 201,
          headers: { Location: `/api/jobs/${res.jobPublicId}` },
          body: { ok: true, jobId: res.jobPublicId, operationId },
        }
      } catch (e) {
        return {
          status: 500,
          body: { code: "RUN_NOW_FAILED" },
        }
      }
    },
  })
})

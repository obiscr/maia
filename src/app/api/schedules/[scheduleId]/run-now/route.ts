import { mark, withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { runScheduleNowByPublicId } from "@/lib/server/services/schedules/run-now-schedule"

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
      const res = await runScheduleNowByPublicId({ auth, viewerAuth, scheduleId: schedulePublicId }).catch(() => null)
      if (!res) return { status: 404, body: { code: "NOT_FOUND" } }
      mark("engine.tick")
      return {
        status: 201,
        headers: { Location: `/api/jobs/${res.jobPublicId}` },
        body: { ok: true, jobId: res.jobPublicId, operationId },
      }
    },
  })
})

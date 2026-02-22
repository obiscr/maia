import { z } from "zod"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { deleteScheduleByPublicId } from "@/lib/server/services/schedules/delete-schedule"
import { getScheduleByPublicId } from "@/lib/server/services/schedules/get-schedule"
import { patchScheduleByPublicId, patchScheduleSchema } from "@/lib/server/services/schedules/patch-schedule"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ scheduleId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { scheduleId } = await ctx.params
  const schedule = await getScheduleByPublicId({ viewerAuth, scheduleId })
  if (!schedule) return notFound("NOT_FOUND")
  return ok({ schedule })
})

export const PATCH = withApiObservability(async (req: Request, ctx: { params: Promise<{ scheduleId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { scheduleId } = await ctx.params
  let body: z.infer<typeof patchScheduleSchema>
  try {
    body = patchScheduleSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const updated = await patchScheduleByPublicId({ auth, viewerAuth, scheduleId, body })
  if (!updated.ok) {
    if (updated.status === 404) return notFound("NOT_FOUND")
    return fail({ status: updated.status, code: updated.code, issues: updated.issues, meta: updated.meta })
  }
  return ok({ schedule: updated.schedule })
})

export const DELETE = withApiObservability(async (_req: Request, ctx: { params: Promise<{ scheduleId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { scheduleId } = await ctx.params
  const deleted = await deleteScheduleByPublicId({ viewerAuth, scheduleId })
  if (!deleted.ok) return notFound("NOT_FOUND")
  return ok({ ok: true })
})

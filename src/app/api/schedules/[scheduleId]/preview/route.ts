import { fail, notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { zodIssues } from "@/lib/shared/http/zod"
import { z } from "zod"
import { requireRequestAuth } from "@/lib/server/authz"
import { previewScheduleByPublicId, previewScheduleQuerySchema } from "@/lib/server/services/schedules/preview-schedule"

export const runtime = "nodejs"

const querySchema = previewScheduleQuerySchema

export const GET = withApiObservability(async (req: Request, ctx: { params: Promise<{ scheduleId: string }> }) => {
  const auth = requireRequestAuth()
  const { scheduleId } = await ctx.params
  const schedulePublicId = String(scheduleId || "")
    .trim()
    .toLowerCase()
  const url = new URL(req.url)

  let qp: z.infer<typeof querySchema>
  try {
    qp = querySchema.parse({ limit: url.searchParams.get("limit") ?? undefined })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  const preview = await previewScheduleByPublicId({ auth, scheduleId: schedulePublicId, query: qp })
  if (!preview) return notFound("NOT_FOUND")
  return ok(preview)
})

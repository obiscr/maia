import { z } from "zod"

import { fail, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { createSchedule, createScheduleSchema } from "@/lib/server/services/schedules/create-schedule"
import { listSchedules, listSchedulesQuerySchema } from "@/lib/server/services/schedules/list-schedules"

export const runtime = "nodejs"

const getSchedulesQuerySchema = listSchedulesQuerySchema

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const url = new URL(req.url)
  let qp: z.infer<typeof getSchedulesQuerySchema>
  try {
    qp = getSchedulesQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  return ok(await listSchedules({ viewerAuth, query: qp }))
})

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  return await runIdempotentOperation({
    req,
    action: "SCHEDULE_CREATE",
    scope: "schedules:create",
    targetType: "schedule",
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      let body: z.infer<typeof createScheduleSchema>
      try {
        body = createScheduleSchema.parse(await req.json())
      } catch (e) {
        if (e instanceof z.ZodError) return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
        throw e
      }

      const created = await createSchedule({ auth, viewerAuth, body })
      if (!created.ok) {
        return {
          status: created.status,
          body: { code: created.code, issues: created.issues, meta: created.meta },
        }
      }
      return {
        status: 201,
        headers: { Location: `/api/schedules/${created.schedulePublicId}` },
        body: {
          // Avoid leaking internal UUIDs.
          schedule: { id: created.schedulePublicId, publicId: created.schedulePublicId },
          operationId,
        },
      }
    },
  })
})

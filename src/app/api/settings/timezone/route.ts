import { z } from "zod"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { zodIssues } from "@/lib/shared/http/zod"
import { getUiTimezoneForUser, saveUiTimezoneForUser } from "@/lib/server/settings/timezone-settings"

export const runtime = "nodejs"

const updateSchema = z.object({
  // null => clear; string => set/update; undefined => unchanged
  timezone: z.union([z.string(), z.null()]).optional(),
})

export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  const timezone = await getUiTimezoneForUser(user.id)
  mark("read")
  return ok({ settings: { timezone } })
})

export const PUT = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  let body: z.infer<typeof updateSchema>
  try {
    body = updateSchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    }
    throw e
  }

  // If not provided, just return current.
  if (body.timezone === undefined) {
    const timezone = await getUiTimezoneForUser(user.id)
    mark("read")
    return ok({ settings: { timezone } })
  }

  const settings = await saveUiTimezoneForUser({ userId: user.id, timezone: body.timezone })
  mark("write")
  return ok({ settings })
})


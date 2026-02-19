import { z } from "zod"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { getAgentSettingsStatusForUser, saveAgentSettingsForUser, getAvailableModels } from "@/lib/server/maia/agent-settings"
import { fail, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { mark, withApiObservability } from "@/lib/server/observability"

export const runtime = "nodejs"

const updateSchema = z.object({
  // null => clear; string => set/update; undefined => unchanged
  apiKey: z.union([z.string(), z.null()]).optional(),
  model: z.string().optional(),
})

export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  // Never expose plaintext API keys to clients.
  const settings = await getAgentSettingsStatusForUser(user.id)
  const models = getAvailableModels()
  mark("read")
  return ok({ settings, models })
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
  const settings = await saveAgentSettingsForUser({
    userId: user.id,
    apiKey: body.apiKey ?? undefined,
    model: body.model ?? undefined,
  })
  const models = getAvailableModels()
  mark("write")
  return ok({ settings, models })
})

import { z } from "zod"

import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { getAgentSettingsForUser } from "@/lib/server/maia/agent-settings"
import { createOpenRouterModel } from "@/lib/server/agent/openrouter"
import { generateCronExpression } from "@/lib/server/chat/tools"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"
export const maxDuration = 60

const bodySchema = z.object({
  locale: z.string().trim().min(2).max(16).default("en"),
  prompt: z.string().trim().min(1).max(2000),
})

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    return fail({ status: 400, code: "INVALID_BODY" })
  }

  const settings = await getAgentSettingsForUser(auth.userId, { touchApiKeyLastUsed: true })
  if (!settings.apiKey) return fail({ status: 422, code: "AGENT_API_KEY_MISSING" })

  const model = createOpenRouterModel({ apiKey: settings.apiKey, model: settings.model })
  const result = await generateCronExpression({ prompt: body.prompt, locale: body.locale, model })

  if (result.ok) return ok({ cron: result.cron })
  if (result.code === "CRON_INTENT_UNCLEAR") return fail({ status: 422, code: "CRON_INTENT_UNCLEAR" })
  if (result.code === "CRON_NOT_EXPRESSIBLE") return fail({ status: 422, code: "CRON_NOT_EXPRESSIBLE" })

  return fail({ status: 500, code: "CRON_GENERATION_FAILED" })
})

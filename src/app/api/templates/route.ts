import { ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { listWorkflowTemplates } from "@/lib/server/templates"
import { getLocaleFromCookies } from "@/lib/server/i18n/server"

export const runtime = "nodejs"

export const GET = withApiObservability(async () => {
  requireRequestAuth()
  const locale = await getLocaleFromCookies()
  const templates = await listWorkflowTemplates(locale)
  return ok({ templates })
})

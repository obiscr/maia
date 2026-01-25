import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { getWorkflowTemplateExport } from "@/lib/server/templates"
import { getLocaleFromCookies } from "@/lib/server/i18n/server"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ templateId: string }> }) => {
  requireRequestAuth()
  const { templateId } = await ctx.params
  const locale = await getLocaleFromCookies()
  const exp = await getWorkflowTemplateExport(templateId, locale)
  if (!exp) return fail({ status: 404, code: "NOT_FOUND" })
  return ok({ template: exp })
})

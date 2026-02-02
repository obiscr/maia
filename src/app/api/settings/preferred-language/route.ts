import { z } from "zod"

import { SUPPORTED_LOCALES } from "@/lib/shared/i18n/constants"
import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { zodIssues } from "@/lib/shared/http/zod"
import {
  getOutboundLanguageForUser,
  saveOutboundLanguageForUser,
  type OutboundLanguage,
} from "@/lib/server/settings/outbound-language-settings"

export const runtime = "nodejs"

const updateSchema = z.object({
  outboundLanguage: z.union([z.literal("auto"), z.string()]).optional(),
})

export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  const outboundLanguage = await getOutboundLanguageForUser(user.id)
  mark("read")
  return ok({ settings: { outboundLanguage } })
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

  if (body.outboundLanguage === undefined) {
    const outboundLanguage = await getOutboundLanguageForUser(user.id)
    mark("read")
    return ok({ settings: { outboundLanguage } })
  }

  let outboundLanguage: OutboundLanguage
  if (body.outboundLanguage === "auto") {
    outboundLanguage = "auto"
  } else {
    const normalized = String(body.outboundLanguage ?? "")
      .trim()
      .toLowerCase()
    const canonical =
      normalized === "zh" || normalized === "zh-cn" || normalized.startsWith("zh") ? "zh-cn" : normalized
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(canonical)) {
      return fail({
        status: 422,
        code: "INVALID_BODY",
        issues: [{ path: "/outboundLanguage", message: "Unsupported" }],
      })
    }
    outboundLanguage = canonical as (typeof SUPPORTED_LOCALES)[number]
  }

  const saved = await saveOutboundLanguageForUser({ userId: user.id, outboundLanguage })
  mark("write")
  return ok({ settings: { outboundLanguage: saved } })
})

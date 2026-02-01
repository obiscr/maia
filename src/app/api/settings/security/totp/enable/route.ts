import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability, mark } from "@/lib/server/observability"
import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { verifyTotp } from "@/lib/server/auth/totp"
import { getTotpSecretBase32ForUser } from "@/lib/server/auth/totp-secret"
import { replaceTotpRecoveryCodes } from "@/lib/server/auth/recovery-codes"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { requestLocale, requestOrigin, sendTemplatedEmailBestEffort } from "@/lib/server/email/send-templated-email"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({ code: z.string().trim().min(1).max(16) })

// PUT /api/settings/security/totp/enable
export const PUT = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { totpEnabled: true },
  })
  if (!dbUser) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (dbUser.totpEnabled) return fail({ status: 409, code: "TOTP_ALREADY_ENABLED" })

  const secret = await getTotpSecretBase32ForUser(user.id)
  if (!secret) return fail({ status: 409, code: "TOTP_NOT_SETUP" })

  const okTotp = verifyTotp({ secretBase32: secret, code: body.code, window: 1 })
  if (!okTotp) return fail({ status: 422, code: "TOTP_INVALID" })

  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: true, totpVerifiedAt: new Date() },
    select: { id: true },
  })

  const recoveryCodes = await replaceTotpRecoveryCodes({ userId: user.id, count: 10 })

  // Best-effort email notification (do not block enabling 2FA).
  const smtp = await readSmtpConfig({ touchPasswordLastUsed: true })
  if (smtp.ok) {
    const origin = requestOrigin(req) ?? ""
    const locale = requestLocale(req)
    await sendTemplatedEmailBestEffort({
      smtp,
      to: String(user.email ?? ""),
      key: "TOTP_ENABLED_NOTIFICATION",
      locale,
      vars: { appName: "Maia", instanceOrigin: origin },
    })
  }

  mark("write")
  return ok({ ok: true, recoveryCodes })
})

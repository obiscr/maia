import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability, mark } from "@/lib/server/observability"
import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { verifyPassword } from "@/lib/server/auth/password"
import { clearTotpSecretForUser } from "@/lib/server/auth/totp-secret"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { requestLocale, requestOrigin, sendTemplatedEmailBestEffort } from "@/lib/server/email/send-templated-email"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({ password: z.string().min(1).max(256) })

// PUT /api/settings/security/totp/disable
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
    select: { totpEnabled: true, passwordHash: true },
  })
  if (!dbUser) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (!dbUser.totpEnabled) return ok({ ok: true })

  if (!verifyPassword(body.password, dbUser.passwordHash)) return fail({ status: 401, code: "INVALID_CREDENTIALS" })

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpVerifiedAt: null },
      select: { id: true },
    })
    await tx.totpRecoveryCode.updateMany({
      where: { userId: user.id, usedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    })
  })
  await clearTotpSecretForUser(user.id)

  // Best-effort email notification (do not block disabling 2FA).
  const smtp = await readSmtpConfig({ touchPasswordLastUsed: true })
  if (smtp.ok) {
    const origin = requestOrigin(req) ?? ""
    const locale = requestLocale(req)
    await sendTemplatedEmailBestEffort({
      smtp,
      to: String(user.email ?? ""),
      key: "TOTP_DISABLED_NOTIFICATION",
      locale,
      vars: { appName: "Maia", instanceOrigin: origin },
    })
  }

  mark("write")
  return ok({ ok: true })
})

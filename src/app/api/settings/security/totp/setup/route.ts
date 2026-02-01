import { ok, fail } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { prisma } from "@/lib/server/db"
import { buildOtpauthUrl, generateTotpSecretBase32 } from "@/lib/server/auth/totp"
import { upsertUserSecret, USER_SECRET_KEYS } from "@/lib/server/settings/user-secrets"

export const runtime = "nodejs"

// POST /api/settings/security/totp/setup
export const POST = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, totpEnabled: true },
  })
  if (!dbUser) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (dbUser.totpEnabled) return fail({ status: 409, code: "TOTP_ALREADY_ENABLED" })

  const secretBase32 = generateTotpSecretBase32()
  await upsertUserSecret({ userId: user.id, key: USER_SECRET_KEYS.authTotpSecret, plaintext: secretBase32 })
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpVerifiedAt: null },
    select: { id: true },
  })

  const issuer = String(process.env.APP_NAME ?? "Maia")
  const otpauthUrl = buildOtpauthUrl({ issuer, accountName: dbUser.email, secretBase32 })
  return ok({ ok: true, secretBase32, otpauthUrl })
})

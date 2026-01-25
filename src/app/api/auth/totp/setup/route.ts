import { ok, fail } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { prisma } from "@/lib/server/db"
import { buildOtpauthUrl, generateTotpSecretBase32 } from "@/lib/server/auth/totp"

export const runtime = "nodejs"

// POST /api/auth/totp/setup
// - When enabled in the DB, login requires a valid TOTP code.
// - This endpoint is under /api/auth/* (bypasses centralized gate), so we enforce auth here explicitly.
export const POST = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, totpEnabled: true },
  })
  if (!dbUser) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (dbUser.totpEnabled) return fail({ status: 409, code: "TOTP_ALREADY_ENABLED" })

  // Generate a new secret and store it (not enabled until verified).
  const secretBase32 = generateTotpSecretBase32()
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: secretBase32, totpEnabled: false, totpVerifiedAt: null },
    select: { id: true },
  })

  const issuer = String(process.env.APP_NAME ?? "Maia")
  const otpauthUrl = buildOtpauthUrl({ issuer, accountName: dbUser.email, secretBase32 })

  return ok({ ok: true, secretBase32, otpauthUrl })
})

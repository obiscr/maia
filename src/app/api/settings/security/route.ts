import { prisma } from "@/lib/server/db"
import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { countActiveTotpRecoveryCodes } from "@/lib/server/auth/recovery-codes"

export const runtime = "nodejs"

// GET /api/settings/security
export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { totpEnabled: true, totpVerifiedAt: true },
  })
  if (!dbUser) return fail({ status: 401, code: "UNAUTHORIZED" })

  const recoveryCodesRemaining = await countActiveTotpRecoveryCodes(user.id).catch(() => 0)
  mark("read")

  return ok({
    settings: {
      totpEnabled: Boolean(dbUser.totpEnabled),
      totpVerifiedAt: dbUser.totpVerifiedAt ? dbUser.totpVerifiedAt.toISOString() : null,
      recoveryCodesRemaining,
    },
  })
})

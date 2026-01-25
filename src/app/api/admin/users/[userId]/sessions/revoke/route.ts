import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"

export const runtime = "nodejs"

export const POST = withApiObservability(async (_req: Request, ctx: { params: Promise<{ userId: string }> }) => {
  const auth = requireRequestAuth()
  if (!isAdmin(auth)) return fail({ status: 403, code: "FORBIDDEN" })

  const params = await ctx.params
  const userPublicId = String(params.userId || "").trim()
  if (!userPublicId) return fail({ status: 404, code: "USER_NOT_FOUND" })

  const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true, publicId: true } })
  if (!user) return fail({ status: 404, code: "USER_NOT_FOUND" })

  const now = new Date()
  const updated = await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now },
  })

  return ok({ ok: true, revokedCount: Number(updated.count ?? 0) })
})

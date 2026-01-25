import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"
import { getClientIp } from "@/lib/server/auth/rate-limit"

export const runtime = "nodejs"

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function requestOrigin(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") ?? "http"
  const host = req.headers.get("host")
  if (!host) return null
  return `${proto}://${host}`
}

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ userId: string }> }) => {
  const auth = requireRequestAuth()
  if (!isAdmin(auth)) return fail({ status: 403, code: "FORBIDDEN" })

  const params = await ctx.params
  const userPublicId = String(params.userId || "").trim()
  if (!userPublicId) return fail({ status: 404, code: "USER_NOT_FOUND" })

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { id: true, isDisabled: true },
  })
  if (!user || user.isDisabled) return fail({ status: 404, code: "USER_NOT_FOUND" })

  const token = crypto.randomBytes(32).toString("base64url")
  const tokenHash = sha256Hex(token)
  const now = new Date()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  const clientIp = getClientIp(req)

  await prisma.passwordResetToken.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash,
      createdAt: now,
      expiresAt,
      usedAt: null,
      ip: clientIp === "unknown" ? null : clientIp,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    select: { id: true },
  })

  const origin = requestOrigin(req)
  const resetPath = `/reset-password?token=${encodeURIComponent(token)}`
  const resetUrl = origin ? `${origin}${resetPath}` : resetPath

  return ok({ ok: true, resetUrl, expiresAt: expiresAt.toISOString() })
})

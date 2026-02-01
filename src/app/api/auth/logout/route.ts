import { ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { cookieHeaderForLogout, getSessionCookieSecure, readSessionTokenFromRequest } from "@/lib/server/auth/session"
import { prisma } from "@/lib/server/db"
import { hashOpaqueToken } from "@/lib/server/auth/token"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request) => {
  const token = readSessionTokenFromRequest(req)
  if (token) {
    const tokenHash = hashOpaqueToken(token)
    // Best-effort revoke
    void prisma.session.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } }).catch(() => {})
  }
  return ok({ ok: true }, { headers: { "Set-Cookie": cookieHeaderForLogout({ secure: getSessionCookieSecure(req) }) } })
})

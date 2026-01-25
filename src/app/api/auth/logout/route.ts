import { ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { cookieHeaderForLogout, readSessionTokenFromRequest } from "@/lib/server/auth/session"
import { prisma } from "@/lib/server/db"
import crypto from "node:crypto"

export const runtime = "nodejs"

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

export const POST = withApiObservability(async (req: Request) => {
  const token = readSessionTokenFromRequest(req)
  if (token) {
    const tokenHash = sha256Hex(token)
    // Best-effort revoke
    void prisma.session.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } }).catch(() => {})
  }
  return ok({ ok: true }, { headers: { "Set-Cookie": cookieHeaderForLogout() } })
})

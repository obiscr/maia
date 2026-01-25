import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { hashPassword } from "@/lib/server/auth/password"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  token: z.string().trim().min(10),
  password: z.string().min(1).max(256),
})

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

// POST /api/auth/password/reset
export const POST = withApiObservability(async (req: Request) => {
  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  // Product contract: return stable error codes (UI localizes).
  if (String(body.password ?? "").length < 8) return fail({ status: 422, code: "PASSWORD_TOO_SHORT", meta: { min: 8 } })

  const tokenHash = sha256Hex(body.token)
  const now = new Date()

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, usedAt: true, expiresAt: true },
  })
  if (!row) return fail({ status: 400, code: "RESET_TOKEN_INVALID" })
  if (row.usedAt) return fail({ status: 400, code: "RESET_TOKEN_USED" })
  if (row.expiresAt.getTime() <= now.getTime()) return fail({ status: 400, code: "RESET_TOKEN_EXPIRED" })

  const passwordHash = hashPassword(body.password)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } })
    await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: now } })
    // Revoke all sessions to force re-login after reset.
    await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } })
  })

  return ok({ ok: true })
})

import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z
  .object({
    inviteId: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
  })
  .refine((v) => Boolean(v.inviteId || v.email), { message: "inviteId or email required" })

// POST /api/admin/users/invite/revoke
export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  if (!isAdmin(auth)) return fail({ status: 403, code: "FORBIDDEN" })

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const now = new Date()
  const inviteId = body.inviteId ? String(body.inviteId).trim() : ""
  const email = body.email ? String(body.email).toLowerCase() : ""

  const where = {
    ...(inviteId ? { id: inviteId } : {}),
    ...(email ? { email } : {}),
    usedAt: null as Date | null,
    invalidatedAt: null as Date | null,
    revokedAt: null as Date | null,
    expiresAt: { gt: now },
  }

  const updated = await prisma.signupInviteToken.updateMany({
    where,
    data: { revokedAt: now },
  })

  return ok({ ok: true, revokedCount: updated.count })
})

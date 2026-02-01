import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const getInvitesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

// GET /api/admin/users/invites?q=...&page=...&pageSize=...&sort=...
export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  if (!isAdmin(auth)) return fail({ status: 403, code: "FORBIDDEN" })

  const url = new URL(req.url)
  let qp: z.infer<typeof getInvitesQuerySchema>
  try {
    qp = getInvitesQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  const now = new Date()

  const where = {
    ...(qp.q?.trim()
      ? {
          email: {
            contains: qp.q.trim().toLowerCase(),
          },
        }
      : {}),
    usedAt: null as Date | null,
    invalidatedAt: null as Date | null,
    revokedAt: null as Date | null,
    expiresAt: { gt: now },
  }

  const orderBy = qp.sort === "CREATED_ASC" ? [{ createdAt: "asc" as const }] : [{ createdAt: "desc" as const }]

  const total = await prisma.signupInviteToken.count({ where })
  const rows = await prisma.signupInviteToken.findMany({
    where,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      email: true,
      createdAt: true,
      expiresAt: true,
      invitedByUser: { select: { publicId: true, email: true } },
    },
  })

  return ok({
    ok: true,
    total,
    invites: rows.map((r) => ({
      id: r.id,
      email: r.email,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      invitedBy: r.invitedByUser ? { publicId: r.invitedByUser.publicId, email: r.invitedByUser.email } : null,
    })),
    page: qp.page,
    pageSize: qp.pageSize,
    sort: qp.sort,
    q: qp.q ?? "",
  })
})

import { z } from "zod"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const getUsersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
  disabled: z.enum(["ACTIVE", "DISABLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  if (!isAdmin(auth)) return fail({ status: 403, code: "FORBIDDEN" })

  const url = new URL(req.url)
  let qp: z.infer<typeof getUsersQuerySchema>
  try {
    qp = getUsersQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      role: url.searchParams.get("role") ?? undefined,
      disabled: url.searchParams.get("disabled") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  const andParts: Prisma.UserWhereInput[] = []
  if (qp.q && qp.q.length) {
    andParts.push({
      OR: [{ publicId: { contains: qp.q } }, { email: { contains: qp.q } }, { name: { contains: qp.q } }],
    })
  }
  if (qp.role) andParts.push({ role: qp.role })
  if (qp.disabled === "ACTIVE") andParts.push({ isDisabled: false })
  if (qp.disabled === "DISABLED") andParts.push({ isDisabled: true })

  const where = andParts.length ? { AND: andParts } : undefined
  const orderBy = qp.sort === "CREATED_ASC" ? [{ createdAt: "asc" as const }] : [{ createdAt: "desc" as const }]

  const total = await prisma.user.count({ where })
  const users = await prisma.user.findMany({
    where,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      email: true,
      name: true,
      role: true,
      totpEnabled: true,
      isDisabled: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  const userIds = users.map((u) => u.id)
  const now = new Date()

  const sessionsByUserId = new Map<string, { activeCount: number; lastSeenAt: Date | null }>()
  if (userIds.length) {
    const rows = await prisma.session.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, revokedAt: null, expiresAt: { gt: now } },
      _count: { _all: true },
      _max: { lastSeenAt: true },
    })
    for (const r of rows) {
      sessionsByUserId.set(r.userId, {
        activeCount: Number(r._count?._all ?? 0),
        lastSeenAt: r._max.lastSeenAt ?? null,
      })
    }
  }

  return ok({
    total,
    users: users.map((u) => {
      const sess = sessionsByUserId.get(u.id) ?? { activeCount: 0, lastSeenAt: null }
      return {
        id: u.publicId,
        publicId: u.publicId,
        publicNumber: u.publicNumber,
        email: u.email,
        name: u.name ?? null,
        role: String(u.role),
        totpEnabled: Boolean(u.totpEnabled),
        isDisabled: Boolean(u.isDisabled),
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        activeSessions: sess.activeCount,
        lastSeenAt: sess.lastSeenAt,
      }
    }),
    page: qp.page,
    pageSize: qp.pageSize,
    sort: qp.sort,
    q: qp.q ?? "",
    role: qp.role ?? null,
    disabled: qp.disabled ?? null,
  })
})

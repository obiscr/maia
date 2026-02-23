import "server-only"

import { z } from "zod"
import { ok, fail } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { prisma } from "@/lib/server/db"
import { allocatePublicId } from "@/lib/server/public-ids"

export const runtime = "nodejs"

const bodySchema = z.object({
  workflowId: z.string().trim().min(1).optional(),
  chatId: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  agentMode: z.string().trim().min(1).optional(),
})
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(200).default(""),
})

/**
 * POST /api/chats — pre-allocate a Chat row so the client can navigate to
 * `/agent/{publicId}` before the first message is sent.
 */
export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    return fail({ status: 400, code: "INVALID_BODY" })
  }

  if (body.chatId) {
    const existing = await prisma.chat.findUnique({
      where: { id: body.chatId },
      select: { id: true, publicId: true, userId: true, workflowId: true, model: true, agentMode: true },
    })
    if (existing) {
      if (existing.userId !== auth.userId) return fail({ status: 403, code: "FORBIDDEN" })
      const updateData: { workflowId?: string | null; model?: string | null; agentMode?: string | null } = {}
      if (!existing.workflowId && body.workflowId) updateData.workflowId = body.workflowId
      if (!existing.model && body.model) updateData.model = body.model
      if (!existing.agentMode && body.agentMode) updateData.agentMode = body.agentMode
      if (Object.keys(updateData).length > 0) {
        await prisma.chat.update({
          where: { id: body.chatId },
          data: updateData,
        })
      }
      return ok({ id: existing.id, publicId: existing.publicId })
    }

    const { publicNumber, publicId } = await allocatePublicId(prisma, "chat")
    try {
      const chat = await prisma.chat.create({
        data: {
          id: body.chatId,
          publicNumber,
          publicId,
          userId: auth.userId,
          workflowId: body.workflowId ?? null,
          model: body.model ?? null,
          agentMode: body.agentMode ?? null,
          title: "",
        },
        select: { id: true, publicId: true },
      })
      return ok({ id: chat.id, publicId: chat.publicId })
    } catch {
      // Handle race: if another request created it first, read it back.
      const again = await prisma.chat.findUnique({
        where: { id: body.chatId },
        select: { id: true, publicId: true, userId: true },
      })
      if (again && again.userId === auth.userId) {
        return ok({ id: again.id, publicId: again.publicId })
      }
      return fail({ status: 409, code: "CHAT_ALLOCATE_CONFLICT" })
    }
  }

  const { publicNumber, publicId } = await allocatePublicId(prisma, "chat")
  const chat = await prisma.chat.create({
    data: {
      publicNumber,
      publicId,
      userId: auth.userId,
      workflowId: body.workflowId ?? null,
      model: body.model ?? null,
      agentMode: body.agentMode ?? null,
      title: "",
    },
    select: { id: true, publicId: true },
  })

  return ok({ id: chat.id, publicId: chat.publicId })
})

/**
 * GET /api/chats — list current user's chats (newest first).
 */
export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const sp = new URL(req.url).searchParams

  let query: z.infer<typeof listQuerySchema>
  try {
    query = listQuerySchema.parse({
      limit: sp.get("limit") ?? undefined,
      offset: sp.get("offset") ?? undefined,
      q: sp.get("q") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    return fail({ status: 400, code: "INVALID_QUERY" })
  }

  const where: Record<string, unknown> = { userId: auth.userId }
  if (query.q) {
    where.OR = [{ title: { contains: query.q } }, { publicId: { contains: query.q.toLowerCase() } }]
  }

  const [rows, totalCount] = await Promise.all([
    prisma.chat.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: query.offset,
      take: query.limit,
      select: {
        id: true,
        publicId: true,
        title: true,
        description: true,
        agentMode: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.chat.count({ where }),
  ])

  return ok({
    items: rows.map((row) => ({
      id: row.id,
      publicId: row.publicId,
      title: row.title ?? "",
      description: row.description ?? "",
      agentMode: row.agentMode ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    totalCount,
    limit: query.limit,
    offset: query.offset,
    hasMore: rows.length >= query.limit,
    nextOffset: query.offset + rows.length,
  })
})

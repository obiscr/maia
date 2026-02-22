import "server-only"

import { z } from "zod"
import { ok, fail } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { prisma } from "@/lib/server/db"

export const runtime = "nodejs"

const patchSchema = z.object({
  model: z.string().trim().min(1).optional(),
  title: z.string().max(120).optional(),
})

/**
 * PATCH /api/chats/:chatId — update mutable chat fields (e.g. model).
 */
export const PATCH = withApiObservability(async (req: Request, { params }: { params: Promise<{ chatId: string }> }) => {
  const auth = requireRequestAuth()
  const { chatId } = await params

  let body: z.infer<typeof patchSchema>
  try {
    body = patchSchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    return fail({ status: 400, code: "INVALID_BODY" })
  }

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { userId: true },
  })
  if (!chat) return fail({ status: 404, code: "NOT_FOUND" })
  if (chat.userId !== auth.userId) return fail({ status: 403, code: "FORBIDDEN" })

  const data: Record<string, unknown> = {}
  if (body.model !== undefined) data.model = body.model
  if (body.title !== undefined) data.title = body.title.trim()

  if (Object.keys(data).length > 0) {
    await prisma.chat.update({ where: { id: chatId }, data })
  }

  return ok({ ok: true })
})

/**
 * DELETE /api/chats/:chatId — delete a chat and all messages.
 */
export const DELETE = withApiObservability(
  async (_req: Request, { params }: { params: Promise<{ chatId: string }> }) => {
    const auth = requireRequestAuth()
    const { chatId } = await params

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { userId: true },
    })
    if (!chat) return fail({ status: 404, code: "NOT_FOUND" })
    if (chat.userId !== auth.userId) return fail({ status: 403, code: "FORBIDDEN" })

    await prisma.chat.delete({ where: { id: chatId } })
    return ok({ ok: true })
  },
)

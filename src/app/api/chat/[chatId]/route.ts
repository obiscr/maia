import "server-only"

import { loadChat } from "@/lib/server/chat/persistence"
import { requireRequestAuth } from "@/lib/server/authz"
import { withApiObservability } from "@/lib/server/observability"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_req: Request, { params }: { params: Promise<{ chatId: string }> }) => {
  const auth = requireRequestAuth()
  const { chatId } = await params
  const chat = await loadChat(chatId, { userId: auth.userId })

  if (!chat) {
    return Response.json({ chat: null }, { status: 404 })
  }

  return Response.json({
    chat: {
      id: chat.id,
      title: chat.title,
      workflowId: chat.workflowId,
      messages: chat.messages,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    },
  })
})

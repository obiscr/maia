import "server-only"

import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { allocatePublicId } from "@/lib/server/public-ids"
import { type UIMessage, isToolUIPart, getToolName } from "ai"
import type { ToolPart } from "@/lib/shared/agent/tool-parts"
import { isRecord } from "@/lib/shared/lang/is-record"

function ensureMessageIds(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => (m.id ? m : { ...m, id: crypto.randomUUID() }))
}

// ---------------------------------------------------------------------------
// Prune large payloads from tool parts before persisting.
// The full scriptEsm / draft payloads are saved in the Workflow table;
// chat history only needs lightweight summaries for replay.
// ---------------------------------------------------------------------------

const PRUNE_SCRIPT_PLACEHOLDER = "[saved to workflow]"

function prunePartsForStorage(parts: UIMessage["parts"]): UIMessage["parts"] {
  return parts.map((part) => {
    if (!isToolUIPart(part)) return part
    const toolName = getToolName(part)
    const p = part as unknown as ToolPart & Record<string, unknown>

    if (toolName === "draft_step" && isRecord(p.input)) {
      const inp = p.input as Record<string, unknown>
      const step = isRecord(inp.step) ? (inp.step as Record<string, unknown>) : null
      if (step && typeof step.scriptEsm === "string" && step.scriptEsm.length > 200) {
        return {
          ...p,
          input: {
            ...inp,
            step: { ...step, scriptEsm: PRUNE_SCRIPT_PLACEHOLDER },
          },
        } as typeof part
      }
    }

    if (toolName === "finalize_draft") {
      if (isRecord(p.input)) {
        const inp = p.input as Record<string, unknown>
        if (isRecord(inp.draft)) {
          const draft = inp.draft as Record<string, unknown>
          const steps = Array.isArray(draft.steps) ? draft.steps : []
          const prunedSteps = steps.map((s) => {
            if (!isRecord(s)) return s
            const st = s as Record<string, unknown>
            if (typeof st.scriptEsm === "string" && st.scriptEsm.length > 200) {
              return { ...st, scriptEsm: PRUNE_SCRIPT_PLACEHOLDER }
            }
            return s
          })
          return {
            ...p,
            input: { ...inp, draft: { ...draft, steps: prunedSteps } },
          } as typeof part
        }
      }
      if (isRecord(p.output)) {
        const out = p.output as Record<string, unknown>
        if (isRecord(out.draft)) {
          const draft = out.draft as Record<string, unknown>
          const steps = Array.isArray(draft.steps) ? draft.steps : []
          const prunedSteps = steps.map((s) => {
            if (!isRecord(s)) return s
            const st = s as Record<string, unknown>
            if (typeof st.scriptEsm === "string" && st.scriptEsm.length > 200) {
              return { ...st, scriptEsm: PRUNE_SCRIPT_PLACEHOLDER }
            }
            return s
          })
          return {
            ...p,
            output: { ...out, draft: { ...draft, steps: prunedSteps } },
          } as typeof part
        }
      }
    }

    return part
  })
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load a chat by its publicId (e.g. "ch-42") or internal UUID.
 */
export async function loadChat(chatId: string, opts?: { userId?: string }) {
  const isPublicId = /^ch-\d+$/i.test(chatId)
  const chat = isPublicId
    ? await prisma.chat.findUnique({ where: { publicId: chatId.toLowerCase() } })
    : await prisma.chat.findUnique({ where: { id: chatId } })
  if (!chat) return null
  if (opts?.userId && chat.userId !== opts.userId) return null

  const rows = await prisma.message.findMany({
    where: { chatId: chat.id },
    orderBy: { createdAt: "asc" },
  })

  const messages: UIMessage[] = rows.map((row) => {
    let parts: UIMessage["parts"] = []
    try {
      const parsed = JSON.parse(row.parts || "[]")
      if (Array.isArray(parsed)) parts = parsed
    } catch {
      parts = []
    }
    return {
      id: row.id,
      role: row.role as UIMessage["role"],
      parts,
      createdAt: row.createdAt,
    }
  })

  return { ...chat, messages }
}

// ---------------------------------------------------------------------------
// Ensure / Create
// ---------------------------------------------------------------------------

/**
 * Ensure a Chat row exists for a given internal chatId.
 * Allocates a stable publicId (ch-N) at the START of streaming.
 */
export async function ensureChat(params: {
  chatId: string
  userId: string
  workflowId?: string | null
  model?: string | null
}): Promise<{ publicId: string }> {
  const existing = await prisma.chat.findUnique({
    where: { id: params.chatId },
    select: { publicId: true, userId: true, workflowId: true, model: true },
  })
  if (existing) {
    if (existing.userId !== params.userId) {
      throw new Error("CHAT_ACCESS_DENIED")
    }
    const updateData: { workflowId?: string | null; model?: string | null } = {}
    if (!existing.workflowId && params.workflowId) updateData.workflowId = params.workflowId
    if (!existing.model && params.model) updateData.model = params.model
    if (Object.keys(updateData).length > 0) {
      await prisma.chat.update({
        where: { id: params.chatId },
        data: updateData,
      })
    }
    return { publicId: existing.publicId }
  }

  const { publicNumber, publicId } = await allocatePublicId(prisma, "chat")
  await prisma.chat.create({
    data: {
      id: params.chatId,
      publicNumber,
      publicId,
      userId: params.userId,
      workflowId: params.workflowId ?? null,
      model: params.model ?? null,
      title: "",
    },
  })
  return { publicId }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Persist chat messages. Each message gets its own row in the Message table.
 * Large tool payloads (scriptEsm) are pruned before storage.
 */
export async function saveChat(params: {
  chatId: string
  userId: string
  messages: UIMessage[]
  title?: string
  workflowId?: string | null
  model?: string | null
}): Promise<{ publicId: string }> {
  const withIds = ensureMessageIds(params.messages)
  const title = params.title || inferTitle(withIds) || ""

  const { publicId } = await ensureChat({
    chatId: params.chatId,
    userId: params.userId,
    workflowId: params.workflowId,
    model: params.model,
  })

  const updateData: Record<string, unknown> = { title, updatedAt: new Date() }
  if (params.model != null) updateData.model = params.model

  await prisma.chat.update({
    where: { id: params.chatId },
    data: updateData,
  })

  const existingIds = new Set(
    (
      await prisma.message.findMany({
        where: { chatId: params.chatId },
        select: { id: true },
      })
    ).map((m) => m.id),
  )

  const toCreate: Array<{ id: string; chatId: string; role: string; parts: string; attachments: string }> = []
  const toUpdate: Array<{ id: string; parts: string }> = []

  for (const msg of withIds) {
    const prunedParts = prunePartsForStorage(msg.parts)
    const partsJson = JSON.stringify(prunedParts)
    const attachmentsJson = JSON.stringify((msg as unknown as Record<string, unknown>).experimental_attachments ?? [])

    if (existingIds.has(msg.id)) {
      toUpdate.push({ id: msg.id, parts: partsJson })
    } else {
      toCreate.push({
        id: msg.id,
        chatId: params.chatId,
        role: msg.role,
        parts: partsJson,
        attachments: attachmentsJson,
      })
    }
  }

  await prisma.$transaction(async (tx) => {
    if (toCreate.length) {
      await tx.message.createMany({ data: toCreate })
    }
    for (const row of toUpdate) {
      await tx.message.update({ where: { id: row.id }, data: { parts: row.parts } })
    }
  })

  return { publicId }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferTitle(messages: UIMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user")
  if (!firstUser) return ""
  for (const part of firstUser.parts) {
    if (part.type === "text" && part.text.trim()) {
      return part.text.trim().slice(0, 100)
    }
  }
  return ""
}

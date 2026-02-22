import "server-only"

import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { ok, fail } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"

export const runtime = "nodejs"

const HANDOFF_TTL_MS = 30 * 60 * 1000
const CLAIM_TTL_MS = 15 * 1000

const paramsSchema = z.object({
  chatId: z.string().trim().min(1),
})

const putBodySchema = z.object({
  text: z.string().optional(),
  files: z
    .array(
      z.object({
        url: z.string().trim().min(1),
        mediaType: z.string().trim().min(1).optional(),
        filename: z.string().optional(),
      }),
    )
    .optional(),
})

async function resolveChatForUser(params: { chatId: string; userId: string }) {
  const raw = String(params.chatId || "").trim()
  const isPublicId = /^ch-\d+$/i.test(raw)
  const chat = isPublicId
    ? await prisma.chat.findUnique({ where: { publicId: raw.toLowerCase() }, select: { id: true, userId: true } })
    : await prisma.chat.findUnique({ where: { id: raw }, select: { id: true, userId: true } })
  if (!chat) return null
  if (chat.userId !== params.userId) return null
  return chat
}

export const PUT = withApiObservability(async (req: Request, ctx: { params: Promise<{ chatId: string }> }) => {
  const auth = requireRequestAuth()
  const { chatId } = paramsSchema.parse(await ctx.params)

  let body: z.infer<typeof putBodySchema>
  try {
    body = putBodySchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    return fail({ status: 400, code: "INVALID_BODY" })
  }

  const chat = await resolveChatForUser({ chatId, userId: auth.userId })
  if (!chat) return fail({ status: 404, code: "CHAT_NOT_FOUND" })

  const text = String(body.text ?? "").trim()
  const files = (Array.isArray(body.files) ? body.files : [])
    .map((f) => ({
      url: String(f.url ?? "").trim(),
      mediaType: String(f.mediaType ?? "application/octet-stream").trim() || "application/octet-stream",
      filename: typeof f.filename === "string" ? f.filename : undefined,
    }))
    .filter((f) => Boolean(f.url))

  if (!text && files.length === 0) return fail({ status: 422, code: "EMPTY_HANDOFF" })

  const now = Date.now()
  await prisma.chatInitialSend.upsert({
    where: { chatId: chat.id },
    create: {
      chatId: chat.id,
      userId: auth.userId,
      payloadJson: JSON.stringify({ text, files }),
      idempotencyKey: crypto.randomUUID(),
      claimedAt: null,
      consumedAt: null,
      expiresAt: new Date(now + HANDOFF_TTL_MS),
    },
    update: {
      userId: auth.userId,
      payloadJson: JSON.stringify({ text, files }),
      idempotencyKey: crypto.randomUUID(),
      claimedAt: null,
      consumedAt: null,
      expiresAt: new Date(now + HANDOFF_TTL_MS),
    },
  })

  return ok({ ok: true })
})

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ chatId: string }> }) => {
  const auth = requireRequestAuth()
  const { chatId } = paramsSchema.parse(await ctx.params)
  const chat = await resolveChatForUser({ chatId, userId: auth.userId })
  if (!chat) return fail({ status: 404, code: "CHAT_NOT_FOUND" })

  const now = new Date()
  const claimCutoff = new Date(now.getTime() - CLAIM_TTL_MS)
  const claim = await prisma.chatInitialSend.updateMany({
    where: {
      chatId: chat.id,
      userId: auth.userId,
      consumedAt: null,
      expiresAt: { gt: now },
      OR: [{ claimedAt: null }, { claimedAt: { lte: claimCutoff } }],
    },
    data: { claimedAt: now },
  })
  const row = await prisma.chatInitialSend.findUnique({
    where: { chatId: chat.id },
    select: { payloadJson: true, idempotencyKey: true, claimedAt: true, consumedAt: true, expiresAt: true },
  })
  if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) return ok({ handoff: null })
  if (claim.count === 0) {
    // Tolerate duplicate GETs from React Strict Mode in dev:
    // if a recent claim exists, return the same payload again.
    const claimedAt = row.claimedAt?.getTime() ?? 0
    const claimIsFresh = claimedAt > 0 && Date.now() - claimedAt < CLAIM_TTL_MS
    if (!claimIsFresh) return ok({ handoff: null })
  }

  let parsed: Record<string, unknown> | null = null
  try {
    const p = JSON.parse(row.payloadJson)
    if (p && typeof p === "object") parsed = p as Record<string, unknown>
  } catch {
    parsed = null
  }

  const text = String(parsed?.text ?? "").trim()
  const files = (Array.isArray(parsed?.files) ? parsed.files : [])
    .map((x) => ({
      url:
        typeof x === "object" && x && typeof (x as { url?: unknown }).url === "string"
          ? (x as { url: string }).url
          : "",
      mediaType:
        typeof x === "object" && x && typeof (x as { mediaType?: unknown }).mediaType === "string"
          ? (x as { mediaType: string }).mediaType
          : "application/octet-stream",
      filename:
        typeof x === "object" && x && typeof (x as { filename?: unknown }).filename === "string"
          ? (x as { filename: string }).filename
          : undefined,
    }))
    .filter((f) => Boolean(f.url))

  if (!text && files.length === 0) return ok({ handoff: null })
  return ok({ handoff: { text, files, idempotencyKey: row.idempotencyKey } })
})

export const POST = withApiObservability(async (_req: Request, ctx: { params: Promise<{ chatId: string }> }) => {
  const auth = requireRequestAuth()
  const { chatId } = paramsSchema.parse(await ctx.params)
  const chat = await resolveChatForUser({ chatId, userId: auth.userId })
  if (!chat) return fail({ status: 404, code: "CHAT_NOT_FOUND" })

  await prisma.chatInitialSend.updateMany({
    where: { chatId: chat.id, userId: auth.userId, consumedAt: null },
    data: { consumedAt: new Date(), claimedAt: null },
  })
  return ok({ ok: true })
})

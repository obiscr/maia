import "server-only"

import crypto from "node:crypto"
import fs from "node:fs/promises"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { ok, fail } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { ensureChat } from "@/lib/server/chat/persistence"
import { ensureBlobFromBuffer } from "@/lib/server/maia/input-blobs"
import { blobAbsPath } from "@/lib/server/maia/paths"
import { getSettingsEncryptionKeyBytes } from "@/lib/server/settings/crypto"

export const runtime = "nodejs"

const MAX_FILE_BYTES = 6 * 1024 * 1024

const querySchema = z.object({
  chatId: z.string().min(1),
})
const deleteBodySchema = z.object({
  files: z
    .array(
      z.object({
        url: z.string().trim().optional(),
        sha256: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      }),
    )
    .default([]),
})

function isImageMime(mime: string) {
  const t = String(mime || "").toLowerCase()
  return t.startsWith("image/")
}

function attachmentSig(params: { userId: string; sha256: string }) {
  return crypto
    .createHmac("sha256", getSettingsEncryptionKeyBytes())
    .update(`user:${params.userId}|sha:${String(params.sha256 || "").toLowerCase()}`, "utf8")
    .digest("base64url")
}

async function resolveChatForUser(params: { chatId: string; userId: string }) {
  const raw = String(params.chatId || "").trim()
  const isPublicId = /^ch-\d+$/i.test(raw)
  const chat = isPublicId
    ? await prisma.chat.findUnique({
        where: { publicId: raw.toLowerCase() },
        select: { id: true, publicId: true, userId: true },
      })
    : await prisma.chat.findUnique({ where: { id: raw }, select: { id: true, publicId: true, userId: true } })
  if (!chat) return null
  if (chat.userId !== params.userId) return null
  return chat
}

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ chatId: string }> }) => {
  const auth = requireRequestAuth()
  const { chatId } = querySchema.parse(await ctx.params)

  // Ensure chat exists (and is owned by user).
  const existing = await resolveChatForUser({ chatId, userId: auth.userId })
  const ensured = existing
    ? { id: existing.id, publicId: existing.publicId }
    : await (async () => {
        // If the chat doesn't exist yet, create it under this user.
        const stableId = /^ch-\d+$/i.test(chatId) ? "" : chatId
        if (!stableId) return null
        const { publicId } = await ensureChat({ chatId: stableId, userId: auth.userId, workflowId: null })
        return { id: stableId, publicId }
      })()
  if (!ensured) return fail({ status: 404, code: "CHAT_NOT_FOUND" })

  const ct = req.headers.get("content-type") || ""
  if (!ct.includes("multipart/form-data")) return fail({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" })

  const fd = await req.formData()
  const files = fd
    .getAll("files")
    .concat(fd.getAll("file"))
    .filter((x): x is File => x instanceof File)

  if (!files.length) return fail({ status: 422, code: "NO_FILES" })

  const out: Array<{
    sha256: string
    filename: string
    mediaType: string
    sizeBytes: number
    url: string
  }> = []

  for (const f of files) {
    const filename = String(f.name || "image").trim() || "image"
    const mediaType = String(f.type || "").trim() || "application/octet-stream"
    if (!isImageMime(mediaType)) return fail({ status: 422, code: "INVALID_FILE_TYPE", meta: { filename, mediaType } })
    const buf = Buffer.from(await f.arrayBuffer())
    if (buf.byteLength > MAX_FILE_BYTES) {
      return fail({ status: 413, code: "FILE_TOO_LARGE", meta: { filename, maxBytes: MAX_FILE_BYTES } })
    }

    const blob = await ensureBlobFromBuffer({ buf, mime: mediaType })
    const sig = attachmentSig({ userId: auth.userId, sha256: blob.sha256 })
    const url = `/api/chats/${encodeURIComponent(ensured.publicId)}/attachments/${encodeURIComponent(blob.sha256)}?mime=${encodeURIComponent(
      blob.mime ?? mediaType,
    )}&sig=${encodeURIComponent(sig)}`
    out.push({
      sha256: blob.sha256,
      filename,
      mediaType: blob.mime ?? mediaType,
      sizeBytes: blob.sizeBytes,
      url,
    })
  }

  return ok({ chatId: ensured.publicId, files: out })
})

function extractSha256FromUrl(rawUrl: string): string {
  const raw = String(rawUrl || "").trim()
  if (!raw) return ""
  try {
    const u = new URL(raw, "http://localhost")
    const m = u.pathname.match(/\/api\/chats\/[^/]+\/attachments\/([a-f0-9]{64})/i)
    return m?.[1]?.toLowerCase() ?? ""
  } catch {
    return ""
  }
}

export const DELETE = withApiObservability(async (req: Request, ctx: { params: Promise<{ chatId: string }> }) => {
  const auth = requireRequestAuth()
  const { chatId } = querySchema.parse(await ctx.params)
  const chat = await resolveChatForUser({ chatId, userId: auth.userId })
  if (!chat) return fail({ status: 404, code: "CHAT_NOT_FOUND" })

  let body: z.infer<typeof deleteBodySchema>
  try {
    body = deleteBodySchema.parse(await req.json())
  } catch {
    return fail({ status: 422, code: "INVALID_BODY" })
  }

  const shaSet = new Set<string>()
  for (const file of body.files) {
    const byField = String(file.sha256 || "")
      .trim()
      .toLowerCase()
    if (/^[a-f0-9]{64}$/.test(byField)) {
      shaSet.add(byField)
      continue
    }
    const byUrl = extractSha256FromUrl(String(file.url || ""))
    if (byUrl) shaSet.add(byUrl)
  }
  if (shaSet.size === 0) return ok({ deleted: [], skipped: [] })

  const deleted: string[] = []
  const skipped: Array<{ sha256: string; reason: string }> = []

  for (const sha256 of shaSet) {
    const [messageRefCount, inputFileRefCount] = await Promise.all([
      prisma.message.count({ where: { parts: { contains: `/attachments/${sha256}` } } }),
      prisma.inputFile.count({
        where: {
          OR: [{ sha256 }, { blob: { is: { sha256 } } }],
        },
      }),
    ])
    if (messageRefCount > 0 || inputFileRefCount > 0) {
      skipped.push({ sha256, reason: "still_referenced" })
      continue
    }

    const blob = await prisma.inputBlob.findUnique({ where: { sha256 }, select: { id: true } })
    if (!blob) {
      skipped.push({ sha256, reason: "blob_not_found" })
      continue
    }
    await prisma.inputBlob.delete({ where: { id: blob.id } }).catch(() => {})
    await fs.unlink(blobAbsPath(sha256)).catch(() => {})
    deleted.push(sha256)
  }

  return ok({ deleted, skipped })
})

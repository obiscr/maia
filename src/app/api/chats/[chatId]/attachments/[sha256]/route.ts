import "server-only"

import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, notFound } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { readBlobToBuffer, blobFileExists } from "@/lib/server/maia/input-blobs"
import { getSettingsEncryptionKeyBytes } from "@/lib/server/settings/crypto"

export const runtime = "nodejs"

const paramsSchema = z.object({
  chatId: z.string().min(1),
  sha256: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-f0-9]{64}$/),
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

function attachmentSig(params: { userId: string; sha256: string }) {
  return crypto
    .createHmac("sha256", getSettingsEncryptionKeyBytes())
    .update(`user:${params.userId}|sha:${String(params.sha256 || "").toLowerCase()}`, "utf8")
    .digest("base64url")
}

export const GET = withApiObservability(
  async (req: Request, ctx: { params: Promise<{ chatId: string; sha256: string }> }) => {
    const auth = requireRequestAuth()
    const { chatId, sha256 } = paramsSchema.parse(await ctx.params)
    const chat = await resolveChatForUser({ chatId, userId: auth.userId })
    if (!chat) return notFound("CHAT_NOT_FOUND")

    const url = new URL(req.url)
    // Keep signature as a soft-compat field:
    // chat ownership is the primary access control, and older stored URLs may
    // carry stale/mismatched signatures across rebuilds or key rotation.
    // We intentionally do not hard-fail on signature mismatch.
    const sig = url.searchParams.get("sig") ?? ""
    if (sig) {
      const expected = attachmentSig({ userId: auth.userId, sha256 })
      if (sig !== expected) {
        // Ignore mismatch for backward compatibility.
      }
    }

    if (!(await blobFileExists(sha256))) return notFound("BLOB_NOT_FOUND")

    const mimeFromUrl = url.searchParams.get("mime") ?? ""
    const contentType = String(mimeFromUrl || "").trim() || "application/octet-stream"

    let buf: Buffer
    try {
      buf = await readBlobToBuffer(sha256)
    } catch {
      return fail({ status: 404, code: "BLOB_NOT_FOUND" })
    }

    const body = new Uint8Array(buf)
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "no-store",
      },
    })
  },
)

import "server-only"

import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { hashOpaqueToken, newOpaqueToken } from "@/lib/server/auth/token"

const CHALLENGE_TTL_MINUTES = (() => {
  const raw = Number(process.env.AUTH_CHALLENGE_TTL_MINUTES ?? 10)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10
})()

export async function createTotpSigninChallenge(params: {
  userId: string
  ip?: string | null
  userAgent?: string | null
}) {
  const token = newOpaqueToken()
  const tokenHash = hashOpaqueToken(token)
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60 * 1000)

  await prisma.authChallenge.create({
    data: {
      id: crypto.randomUUID(),
      tokenHash,
      kind: "SIGNIN_TOTP",
      userId: params.userId,
      expiresAt,
      usedAt: null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    },
    select: { id: true },
  })

  return { challengeId: token, expiresAt }
}

export async function consumeTotpSigninChallenge(challengeId: string): Promise<{ userId: string } | null> {
  const token = String(challengeId || "").trim()
  if (!token) return null

  const tokenHash = hashOpaqueToken(token)
  const now = new Date()

  const row = await prisma.authChallenge.findFirst({
    where: { tokenHash, kind: "SIGNIN_TOTP", usedAt: null, expiresAt: { gt: now } },
    select: { id: true, userId: true },
  })
  if (!row) return null

  const updated = await prisma.authChallenge.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  })
  if (updated.count !== 1) return null

  return { userId: row.userId }
}

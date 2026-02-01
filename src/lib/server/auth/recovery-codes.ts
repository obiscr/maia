import "server-only"

import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { hashOtpCode, newSalt } from "@/lib/server/auth/token"

// Avoid ambiguous chars: 0/O, 1/I/L.
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

function normalizeRecoveryCode(input: string) {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
}

export function formatRecoveryCodeForDisplay(code: string) {
  const clean = normalizeRecoveryCode(code)
  // 10 chars -> XXXXX-XXXXX (or fallback if different length)
  if (clean.length === 10) return `${clean.slice(0, 5)}-${clean.slice(5)}`
  return clean
}

export function generateRecoveryCode(params?: { length?: number }) {
  const len = typeof params?.length === "number" && params.length >= 8 ? Math.floor(params.length) : 10
  // Rejection sampling for uniform distribution.
  const alphabet = RECOVERY_ALPHABET
  const n = alphabet.length
  const max = Math.floor(256 / n) * n

  let out = ""
  while (out.length < len) {
    const buf = crypto.randomBytes(32)
    for (const b of buf) {
      if (b >= max) continue
      out += alphabet[b % n]
      if (out.length >= len) break
    }
  }
  return out
}

export async function replaceTotpRecoveryCodes(params: { userId: string; count?: number }) {
  const count = typeof params.count === "number" && params.count > 0 ? Math.floor(params.count) : 10
  const now = new Date()

  const codes = Array.from({ length: count }).map(() => generateRecoveryCode({ length: 10 }))
  const rows = codes.map((code) => {
    const salt = newSalt()
    const codeHash = hashOtpCode({ code, salt })
    return {
      id: crypto.randomUUID(),
      userId: params.userId,
      salt,
      codeHash,
      createdAt: now,
      usedAt: null,
      invalidatedAt: null,
    }
  })

  await prisma.$transaction(async (tx) => {
    // Invalidate existing codes (keep history).
    await tx.totpRecoveryCode.updateMany({
      where: { userId: params.userId, usedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    })
    await tx.totpRecoveryCode.createMany({ data: rows })
  })

  return codes.map(formatRecoveryCodeForDisplay)
}

export async function consumeTotpRecoveryCode(params: { userId: string; code: string }) {
  const submitted = normalizeRecoveryCode(params.code)
  if (!submitted) return false
  // Require at least 8 chars to avoid accidental TOTP-like inputs.
  if (submitted.length < 8 || submitted.length > 64) return false

  const candidates = await prisma.totpRecoveryCode.findMany({
    where: { userId: params.userId, usedAt: null, invalidatedAt: null },
    select: { id: true, salt: true, codeHash: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  for (const row of candidates) {
    const hash = hashOtpCode({ code: submitted, salt: row.salt })
    // Hex strings are fixed-length; timingSafeEqual avoids trivial oracle issues.
    if (
      hash.length === row.codeHash.length &&
      crypto.timingSafeEqual(Buffer.from(hash, "utf8"), Buffer.from(row.codeHash, "utf8"))
    ) {
      const updated = await prisma.totpRecoveryCode.updateMany({
        where: { id: row.id, usedAt: null, invalidatedAt: null },
        data: { usedAt: new Date() },
      })
      return updated.count === 1
    }
  }

  return false
}

export async function countActiveTotpRecoveryCodes(userId: string) {
  return await prisma.totpRecoveryCode.count({ where: { userId, usedAt: null, invalidatedAt: null } })
}

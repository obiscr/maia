import "server-only"

import crypto from "node:crypto"

import { cookies } from "next/headers"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"
import { hashOpaqueToken } from "@/lib/server/auth/token"
import { shouldSetSecureCookie } from "@/lib/shared/http/cookie-secure"

export const SESSION_COOKIE_NAME = "maia_session"

const SESSION_TTL_DAYS = (() => {
  const raw = Number(process.env.SESSION_TTL_DAYS ?? 30)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30
})()

export type AuthedUser = {
  id: string
  publicId: string
  publicNumber: number
  email: string
  name: string | null
  role: string
  totpEnabled: boolean
  isDisabled: boolean
}

export function readSessionTokenFromRequest(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? ""
  // very small cookie parser (avoid bringing deps)
  const parts = cookieHeader.split(";")
  for (const p of parts) {
    const [k, ...rest] = p.trim().split("=")
    if (!k) continue
    if (k === SESSION_COOKIE_NAME) return decodeURIComponent(rest.join("=") || "")
  }
  return null
}

export async function getAuthedUserFromRequest(req: Request): Promise<AuthedUser | null> {
  const token = readSessionTokenFromRequest(req)
  if (!token) return null
  if (!isCurrentDatabaseSchemaReadySync()) return null
  const tokenHash = hashOpaqueToken(token)
  const now = new Date()

  const row = await prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          publicId: true,
          publicNumber: true,
          email: true,
          name: true,
          role: true,
          totpEnabled: true,
          isDisabled: true,
        },
      },
    },
  })
  if (!row) return null
  if (row.revokedAt) return null
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null
  if (!row.user || row.user.isDisabled) return null

  // Best-effort lastSeen
  void prisma.session
    .update({ where: { id: row.id }, data: { lastSeenAt: now } satisfies Prisma.SessionUpdateInput })
    .catch(() => {})

  return {
    id: row.user.id,
    publicId: row.user.publicId,
    publicNumber: row.user.publicNumber,
    email: row.user.email,
    name: row.user.name ?? null,
    role: String(row.user.role),
    totpEnabled: Boolean(row.user.totpEnabled),
    isDisabled: Boolean(row.user.isDisabled),
  }
}

export async function getAuthedUserFromCookies(): Promise<AuthedUser | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!token) return null
  const req = new Request("http://local/auth", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
  })
  return await getAuthedUserFromRequest(req)
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString("base64url")
}

export async function createSession(params: {
  userId: string
  ip?: string | null
  userAgent?: string | null
  ttlDays?: number
}) {
  const token = newSessionToken()
  const tokenHash = hashOpaqueToken(token)
  const ttl = typeof params.ttlDays === "number" ? params.ttlDays : SESSION_TTL_DAYS
  const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000)

  await prisma.session.create({
    data: {
      id: crypto.randomUUID(),
      userId: params.userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
      lastSeenAt: new Date(),
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    },
    select: { id: true },
  })

  return { token, expiresAt }
}

export function cookieHeaderForSession(
  token: string,
  opts?: { expiresAt?: Date; maxAgeSeconds?: number; secure?: boolean },
) {
  // Default to Secure unless explicitly disabled via decision logic upstream.
  const parts: string[] = []
  parts.push(`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`)
  parts.push("Path=/")
  parts.push("HttpOnly")
  parts.push("SameSite=Lax")
  const secure = typeof opts?.secure === "boolean" ? opts.secure : true
  if (secure) parts.push("Secure")
  if (opts?.expiresAt instanceof Date) parts.push(`Expires=${opts.expiresAt.toUTCString()}`)
  if (typeof opts?.maxAgeSeconds === "number") parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`)
  return parts.join("; ")
}

export function getSessionCookieSecure(req: Request): boolean {
  return shouldSetSecureCookie({ headers: req.headers, url: req.url })
}

export function cookieHeaderForLogout(opts?: { secure?: boolean }) {
  return cookieHeaderForSession("", { maxAgeSeconds: 0, expiresAt: new Date(0), secure: opts?.secure })
}

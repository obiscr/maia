import "server-only"

import { Prisma, type PrismaClient } from "@prisma/client"

export type PublicIdKind = "workflow" | "run" | "job" | "schedule" | "batch" | "operation" | "user" | "chat"

const PREFIX_BY_KIND: Record<PublicIdKind, string> = {
  workflow: "wf",
  run: "run",
  job: "job",
  schedule: "sch",
  batch: "bat",
  operation: "op",
  user: "usr",
  chat: "ch",
}

const COUNTER_KEY_BY_KIND: Record<PublicIdKind, string> = {
  workflow: "workflow",
  run: "run",
  job: "job",
  schedule: "schedule",
  batch: "batch",
  operation: "operation",
  user: "user",
  chat: "chat",
}

export function normalizePublicId(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
}

export function formatPublicId(kind: PublicIdKind, publicNumber: number) {
  return `${PREFIX_BY_KIND[kind]}-${publicNumber}`
}

export function formatPublicIdForDisplay(publicId: string) {
  // UI display convention: prefix uppercased.
  return String(publicId || "")
    .trim()
    .toUpperCase()
}

export function assertLooksLikePublicId(raw: string) {
  const v = normalizePublicId(raw)
  // e.g. job-1, wf-12, sch-380
  if (!/^[a-z]{2,4}-[1-9][0-9]*$/.test(v)) throw new Error("Invalid publicId")
  return v
}

/**
 * Allocates the next per-kind public number.
 *
 * Counter semantics:
 * - row stores `nextNumber` (the next number to allocate, starting at 1)
 * - we upsert and increment `nextNumber`
 * - allocated number is always `row.nextNumber - 1` after the increment
 *
 * This works for SQLite and remains atomic as long as it's called inside a transaction.
 */
export async function allocatePublicNumber(tx: PrismaClient | Prisma.TransactionClient, kind: PublicIdKind) {
  const key = COUNTER_KEY_BY_KIND[kind]
  const row = await tx.publicIdCounter.upsert({
    where: { key },
    create: { key, nextNumber: 2 }, // allocate 1; next will be 2
    update: { nextNumber: { increment: 1 } },
    select: { nextNumber: true },
  })
  const allocated = Number(row?.nextNumber ?? 0) - 1
  if (!Number.isInteger(allocated) || allocated <= 0) throw new Error(`Failed to allocate public number for ${kind}`)
  return allocated
}

export async function allocatePublicId(tx: PrismaClient | Prisma.TransactionClient, kind: PublicIdKind) {
  const publicNumber = await allocatePublicNumber(tx, kind)
  return { publicNumber, publicId: formatPublicId(kind, publicNumber) }
}

export async function allocatePublicNumberBlock(
  tx: PrismaClient | Prisma.TransactionClient,
  kind: PublicIdKind,
  count: number,
) {
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n) || n <= 0) throw new Error("count must be a positive integer")
  const key = COUNTER_KEY_BY_KIND[kind]

  // SQLite: use a single upsert with RETURNING to allocate [start..start+n-1].
  // We store `nextNumber` (next to allocate). After incrementing by n, start is (nextNumber - n).
  const rows = await tx.$queryRaw<Array<{ nextNumber: number }>>(
    Prisma.sql`
      INSERT INTO PublicIdCounter (key, nextNumber)
      VALUES (${key}, ${1 + n})
      ON CONFLICT(key) DO UPDATE SET nextNumber = nextNumber + ${n}
      RETURNING nextNumber
    `,
  )

  const nextNumber = Array.isArray(rows) && rows.length ? Number(rows[0]?.nextNumber ?? 0) : 0

  const start = nextNumber - n
  if (!Number.isInteger(start) || start <= 0) throw new Error(`Failed to allocate public number block for ${kind}`)
  return start
}

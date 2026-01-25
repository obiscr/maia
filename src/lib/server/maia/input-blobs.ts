import "server-only"

import crypto from "crypto"
import fs from "fs/promises"
import path from "path"

import { prisma } from "@/lib/server/db"
import { ensureDir, pathExists } from "@/lib/server/maia/fs"
import { blobAbsPath, blobRelPath } from "@/lib/server/maia/paths"

function normalizeSha256Hex(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
}

export async function ensureBlobFromBuffer(params: { buf: Buffer; mime?: string | null }) {
  const sha256 = crypto.createHash("sha256").update(params.buf).digest("hex")
  const sizeBytes = params.buf.byteLength
  const mime = params.mime ? String(params.mime) : null

  const storagePath = blobRelPath(sha256)
  const abs = blobAbsPath(sha256)

  // Best-effort write if missing.
  if (!(await pathExists(abs))) {
    await ensureDir(path.dirname(abs))
    await fs.writeFile(abs, params.buf)
  }

  // Upsert metadata row (sha256 is unique).
  const row = await prisma.inputBlob.upsert({
    where: { sha256: normalizeSha256Hex(sha256) },
    update: {
      sizeBytes,
      mime,
      storagePath,
    },
    create: {
      id: crypto.randomUUID(),
      sha256: normalizeSha256Hex(sha256),
      sizeBytes,
      mime,
      storagePath,
    },
    select: { id: true, sha256: true, sizeBytes: true, mime: true, storagePath: true },
  })

  return row
}

/**
 * Store a blob from a temp file path and return the InputBlob row.
 * The file is moved into the blob store when possible.
 */
export async function ensureBlobFromTempFile(params: {
  tmpAbsPath: string
  mime?: string | null
  sizeBytes: number
  sha256?: string | null
}) {
  const tmp = String(params.tmpAbsPath || "").trim()
  if (!tmp) throw new Error("tmpAbsPath required")

  // Optional precomputed SHA-256 (avoid double-read).
  let sha256 = ""
  if (typeof params.sha256 === "string" && params.sha256.trim()) {
    sha256 = normalizeSha256Hex(params.sha256)
  } else {
    // Compute sha256 without loading whole file into memory.
    const hash = crypto.createHash("sha256")
    const fh = await fs.open(tmp, "r")
    try {
      const buf = Buffer.allocUnsafe(1024 * 1024)
      let pos = 0
      while (true) {
        const r = await fh.read(buf, 0, buf.byteLength, pos)
        if (!r.bytesRead) break
        hash.update(buf.subarray(0, r.bytesRead))
        pos += r.bytesRead
      }
    } finally {
      await fh.close()
    }
    sha256 = normalizeSha256Hex(hash.digest("hex"))
  }
  const abs = blobAbsPath(sha256)
  const storagePath = blobRelPath(sha256)
  const mime = params.mime ? String(params.mime) : null
  const sizeBytes = Number(params.sizeBytes || 0) || 0

  if (!(await pathExists(abs))) {
    await ensureDir(path.dirname(abs))
    // Try atomic move first (same filesystem). Fall back to copy+unlink.
    try {
      await fs.rename(tmp, abs)
    } catch {
      await fs.copyFile(tmp, abs)
      await fs.unlink(tmp).catch(() => {})
    }
  } else {
    // Blob already exists, delete temp.
    await fs.unlink(tmp).catch(() => {})
  }

  const row = await prisma.inputBlob.upsert({
    where: { sha256 },
    update: {
      sizeBytes,
      mime,
      storagePath,
    },
    create: {
      id: crypto.randomUUID(),
      sha256,
      sizeBytes,
      mime,
      storagePath,
    },
    select: { id: true, sha256: true, sizeBytes: true, mime: true, storagePath: true },
  })
  return row
}

export async function readBlobToBuffer(sha256: string) {
  const abs = blobAbsPath(sha256)
  return await fs.readFile(abs)
}

export async function blobFileExists(sha256: string) {
  return await pathExists(blobAbsPath(sha256))
}

import "server-only"

import crypto from "crypto"
import path from "path"
import fs from "fs/promises"

import { ensureDir, sha256 } from "@/lib/server/maia/fs"

export type JobInputFile =
  | {
      id: string
      name: string
      source: "upload"
      status: "ready"
      path?: string
      sizeBytes?: number
      sha256?: string
      mime?: string
    }
  | {
      id: string
      name: string
      source: "url"
      url: string
      status: "fetching" | "failed" | "ready"
      path?: string
      sizeBytes?: number
      sha256?: string
      mime?: string
      error?: string
    }

export function sanitizeFilename(name: string) {
  const base = (name || "file")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
  return base.slice(0, 120) || "file"
}

export async function persistUploadToDir(params: { baseDir: string; file: File }) {
  const id = crypto.randomUUID()
  const name = sanitizeFilename(params.file.name || "file")
  const rel = path.join("uploads", `${id}-${name}`)
  const abs = path.join(params.baseDir, rel)
  const buf = Buffer.from(await params.file.arrayBuffer())
  await ensureDir(path.dirname(abs))
  await fs.writeFile(abs, buf)
  return {
    id,
    name,
    rel,
    sizeBytes: buf.byteLength,
    sha256: sha256(buf),
    mime: params.file.type || undefined,
  }
}

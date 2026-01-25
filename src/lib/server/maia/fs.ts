import "server-only"

import crypto from "crypto"
import fs from "fs/promises"
import path from "path"

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

export async function pathExists(p: string) {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

export function sha256(input: string | Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

export async function writeTextAtomic(filePath: string, content: string) {
  const dir = path.dirname(filePath)
  await ensureDir(dir)
  const tmp = `${filePath}.tmp-${crypto.randomUUID()}`
  await fs.writeFile(tmp, content, "utf8")
  await fs.rename(tmp, filePath)
}

export async function writeJsonAtomic(filePath: string, data: unknown) {
  await writeTextAtomic(filePath, JSON.stringify(data, null, 2))
}

export async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8")
  return JSON.parse(raw) as T
}

export async function readJsonFileOrNull<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw) as T
  } catch (e) {
    // Common race: API is queried before engine writes the file.
    const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code?: unknown }).code) : null
    if (code === "ENOENT") return null
    throw e
  }
}

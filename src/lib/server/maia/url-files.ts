import "server-only"

import crypto from "node:crypto"

import { sanitizeFilename } from "@/lib/server/maia/job-files"
import { isRecord } from "@/lib/shared/lang/is-record"

export type StoredUrlFile = {
  id: string
  url: string
  name: string
}

export type UrlFileInput = {
  url: string
  name?: string
  id?: string
}

function defaultNameFromUrl(urlStr: string) {
  try {
    const u = new URL(urlStr)
    const seg = u.pathname.split("/").filter(Boolean).pop()
    const raw = seg ? decodeURIComponent(seg) : "download"
    return sanitizeFilename(raw || "download")
  } catch {
    return "download"
  }
}

export function normalizeUrlFilesForStorage(raw: unknown, opts?: { maxItems?: number | null }): StoredUrlFile[] {
  const max =
    typeof opts?.maxItems === "number" && Number.isFinite(opts.maxItems) ? Math.max(1, Math.floor(opts.maxItems)) : null
  const arr = Array.isArray(raw) ? raw : []

  const out: StoredUrlFile[] = []
  for (const it of arr) {
    const rec = isRecord(it) ? it : null
    const url = rec && typeof rec.url === "string" ? rec.url.trim() : ""
    if (!url) continue
    const id = rec && typeof rec.id === "string" && rec.id.trim() ? String(rec.id).trim() : crypto.randomUUID()
    const nameRaw =
      rec && typeof rec.name === "string" && rec.name.trim() ? String(rec.name).trim() : defaultNameFromUrl(url)
    const name = sanitizeFilename(nameRaw || "download")
    out.push({ id, url, name })
    if (max != null && out.length >= max) break
  }

  return out
}

export function parseStoredUrlFilesJson(raw: unknown): StoredUrlFile[] {
  const s = typeof raw === "string" ? raw : ""
  if (!s.trim()) return []
  try {
    const parsed: unknown = JSON.parse(s)
    return normalizeUrlFilesForStorage(parsed)
  } catch {
    return []
  }
}

export function toUrlInputFiles(files: StoredUrlFile[]) {
  return files.map((f) => ({
    id: f.id,
    name: f.name,
    source: "url" as const,
    url: f.url,
    status: "fetching" as const,
  }))
}

/**
 * Merge system-managed URL input files into an existing input JSON string.
 * - Ensures `files` is overwritten (reserved field).
 * - Preserves existing keys when the input parses as an object.
 * - Falls back to `{ value: <parsed>, files: [...] }` when input is non-object.
 */
export function mergeUrlInputFilesIntoInputJson(params: {
  inputJson: string
  urlInputFiles: ReturnType<typeof toUrlInputFiles>
}): string {
  const inputJson = typeof params.inputJson === "string" && params.inputJson.trim().length ? params.inputJson : "{}"
  const files = params.urlInputFiles
  if (!files.length) return inputJson

  try {
    const parsed: unknown = JSON.parse(inputJson || "{}")
    const normalized: Record<string, unknown> = isRecord(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : { value: parsed }
    delete normalized["files"]
    normalized["files"] = files
    return JSON.stringify(normalized)
  } catch {
    return JSON.stringify({ files })
  }
}

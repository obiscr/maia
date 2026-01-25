import "server-only"

import crypto from "crypto"
import dns from "dns/promises"
import fssync from "fs"
import fs from "fs/promises"
import net from "net"
import path from "path"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import type { ReadableStream as WebReadableStream } from "stream/web"

import { LogLevel, RunStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import {
  INPUT_DOWNLOAD_CONCURRENCY,
  INPUT_DOWNLOAD_MAX_BYTES,
  INPUT_DOWNLOAD_TIMEOUT_MS,
} from "@/lib/server/maia/config"
import { ensureDir, pathExists } from "@/lib/server/maia/fs"
import { emitInputFileStatus, emitRunStatus, emitSystem } from "@/lib/server/maia/logging"
import { blobAbsPath, runDir } from "@/lib/server/maia/paths"
import { ensureBlobFromTempFile } from "@/lib/server/maia/input-blobs"

import type { DownloadingInput, RunInputFile } from "@/lib/server/maia/engine/types"
import { isUrlInputFile } from "@/lib/server/maia/engine/types"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

function isRunInputFile(x: unknown): x is RunInputFile {
  if (!isPlainObject(x)) return false
  if (typeof x.id !== "string" || typeof x.name !== "string") return false
  if (x.source === "upload") {
    return x.status === "ready" && typeof x.path === "string"
  }
  if (x.source === "url") {
    if (typeof x.url !== "string") return false
    return x.status === "fetching" || x.status === "failed" || x.status === "ready"
  }
  return false
}

function isPrivateIp(ip: string) {
  // IPv4 RFC1918 + loopback + link-local; IPv6 loopback/link-local/ULA
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map((x) => Number(x))
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    return false
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase()
    if (normalized === "::1") return true
    if (normalized.startsWith("fe80:")) return true // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true // ULA fc00::/7
    return false
  }
  return true
}

async function assertSafeUrl(urlStr: string) {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    throw new Error("Invalid URL")
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http/https URLs are allowed")
  const host = u.hostname
  if (!host) throw new Error("Invalid URL host")
  if (host === "localhost") throw new Error("Blocked host")
  const ipLiteral = net.isIP(host)
  if (ipLiteral) {
    if (isPrivateIp(host)) throw new Error("Blocked private/loopback IP")
    return
  }
  // Resolve DNS and block private IPs
  const addrs = await dns.lookup(host, { all: true })
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("Blocked private/loopback IP (DNS resolved)")
  }
}

function sanitizeFilename(name: string) {
  const base = (name || "file")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
  return base.slice(0, 120) || "file"
}

async function updateRunInputFile(
  runId: string,
  fileId: string,
  patch: Partial<RunInputFile> & { status?: RunInputFile["status"] },
) {
  const run = await prisma.run.findUnique({ where: { id: runId } })
  if (!run) return null
  let parsedRaw: unknown
  try {
    parsedRaw = JSON.parse(run.initialInput || "{}")
  } catch {
    return null
  }
  const parsed = isPlainObject(parsedRaw) ? (parsedRaw as Record<string, unknown>) : { value: parsedRaw }
  const filesRaw = Array.isArray(parsed.files) ? parsed.files : []
  const files: unknown[] = Array.isArray(filesRaw) ? filesRaw : []
  const idx = files.findIndex((x) => isPlainObject(x) && x.id === fileId)
  if (idx < 0) return null
  const cur = isPlainObject(files[idx]) ? (files[idx] as Record<string, unknown>) : {}
  files[idx] = { ...cur, ...patch }
  parsed.files = files
  await prisma.run.update({ where: { id: runId }, data: { initialInput: JSON.stringify(parsed) } })
  return parsed
}

async function downloadUrlInputFile(params: {
  inputDownloads: Map<string, DownloadingInput>
  runId: string
  file: { id: string; name: string; url: string }
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  const { inputDownloads, runId, file } = params
  const key = `${runId}:${file.id}`
  if (inputDownloads.has(key)) return
  const abort = new AbortController()
  inputDownloads.set(key, { runId, fileId: file.id, abort })

  const timeout = setTimeout(() => abort.abort(new Error("download timeout")), INPUT_DOWNLOAD_TIMEOUT_MS)
  try {
    await assertSafeUrl(file.url)

    const safeName = sanitizeFilename(file.name || "download")
    const relPath = path.join("uploads", `${file.id}-${safeName}`)
    const absPath = path.join(runDir(runId), relPath)
    await ensureDir(path.dirname(absPath))

    const res = await fetch(file.url, { signal: abort.signal, redirect: "follow" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const contentLength = res.headers.get("content-length")
    if (contentLength) {
      const n = Number(contentLength)
      if (Number.isFinite(n) && n > INPUT_DOWNLOAD_MAX_BYTES) throw new Error("File too large")
    }
    const contentType = res.headers.get("content-type") ?? undefined

    if (!res.body) throw new Error("Missing response body")

    const tmpPath = `${absPath}.tmp-${crypto.randomUUID()}`
    let seen = 0
    const hash = crypto.createHash("sha256")
    const writable = fssync.createWriteStream(tmpPath)
    const readable = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>)

    readable.on("data", (chunk: Buffer) => {
      seen += chunk.length
      hash.update(chunk)
      if (seen > INPUT_DOWNLOAD_MAX_BYTES) {
        abort.abort(new Error("File too large"))
      }
    })

    await pipeline(readable, writable)
    const sha = hash.digest("hex")

    // Move into blob store (content-addressed), then materialize into run/uploads.
    const blob = await ensureBlobFromTempFile({
      tmpAbsPath: tmpPath,
      sha256: sha,
      sizeBytes: seen,
      mime: contentType ?? null,
    })
    const blobFile = blobAbsPath(blob.sha256)
    try {
      await fs.link(blobFile, absPath)
    } catch {
      try {
        await fs.copyFile(blobFile, absPath)
      } catch {}
    }

    // SSOT: update InputFile row (job-scoped input file).
    await prisma.inputFile.updateMany({
      where: { id: file.id },
      data: {
        status: "READY",
        error: null,
        blobId: blob.id,
        sha256: blob.sha256,
        sizeBytes: blob.sizeBytes,
        mime: blob.mime ?? null,
      },
    })

    await updateRunInputFile(runId, file.id, {
      status: "ready",
      path: relPath,
      sizeBytes: blob.sizeBytes,
      sha256: blob.sha256,
      mime: contentType,
      error: undefined,
    })

    await emitInputFileStatus({
      runId,
      fileId: file.id,
      status: "ready",
      path: relPath,
      error: null,
      sizeBytes: blob.sizeBytes,
      sha256: blob.sha256,
      mime: contentType ?? null,
    }).catch(() => {})
    await emitSystem(runId, `downloaded input file: ${safeName}`, LogLevel.INFO)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await prisma.inputFile.updateMany({
      where: { id: file.id },
      data: { status: "FAILED", error: msg },
    })

    await prisma.run.updateMany({
      where: { id: runId, failureCode: null, failureAt: null },
      data: {
        failureCode: "INPUT_DOWNLOAD_FAILED",
        failureMessage: "input download failed",
        failureMetaJson: JSON.stringify({
          kind: "INPUT_DOWNLOAD_FAILED",
          failed: [{ fileId: file.id, name: file.name, url: file.url, error: msg }],
        }),
        failureAt: new Date(),
      },
    })

    await updateRunInputFile(runId, file.id, {
      status: "failed",
      error: msg,
    })
    await emitInputFileStatus({
      runId,
      fileId: file.id,
      status: "failed",
      path: null,
      error: msg,
      sizeBytes: null,
      sha256: null,
      mime: null,
    }).catch(() => {})
    await params.finishRun(runId, RunStatus.FAILED)
    await emitSystem(runId, `input download failed: ${file.name} (${msg})`, LogLevel.ERROR)
  } finally {
    clearTimeout(timeout)
    inputDownloads.delete(key)
  }
}

export async function processPendingInputs(params: {
  inputDownloads: Map<string, DownloadingInput>
  finishRun: (runId: string, status: RunStatus) => Promise<void>
}) {
  // 1) Move runs that have no remaining downloads to RUNNING.
  // 2) Start URL downloads up to concurrency.
  const runs = await prisma.run.findMany({
    where: { status: RunStatus.PENDING_INPUTS },
    orderBy: [{ createdAt: "asc" }],
    take: 25,
  })

  const available = Math.max(0, INPUT_DOWNLOAD_CONCURRENCY - params.inputDownloads.size)
  let slots = available

  for (const r of runs) {
    // Prefer SSOT: InputFile table (job-scoped).
    const job = await prisma.jobRun.findFirst({ where: { runId: r.id }, select: { id: true } })
    if (job) {
      const urlInputs = await prisma.inputFile.findMany({
        where: { jobRunId: job.id, source: "URL" },
        select: { id: true, name: true, url: true, status: true, error: true },
      })
      const anyFailed = urlInputs.some((f) => f.status === "FAILED")
      if (anyFailed) {
        // Standardized classification for input acquisition failures.
        await prisma.run.update({
          where: { id: r.id },
          data: {
            failureCode: "INPUT_DOWNLOAD_FAILED",
            failureMessage: "input download failed",
            failureMetaJson: JSON.stringify({
              kind: "INPUT_DOWNLOAD_FAILED",
              failed: urlInputs
                .filter((f) => f.status === "FAILED")
                .map((f) => ({ fileId: f.id, name: f.name, url: f.url, error: f.error })),
            }),
            failureAt: new Date(),
          },
        })
        await params.finishRun(r.id, RunStatus.FAILED)
        continue
      }

      const pending = urlInputs.filter((f) => f.status === "FETCHING")
      if (pending.length === 0) {
        // All inputs ready => move to RUNNING (Path A: Jobs are the queue; runs should not go back to PENDING).
        await prisma.run.update({
          where: { id: r.id },
          data: { status: RunStatus.RUNNING, startedAt: r.startedAt ?? new Date(), finishedAt: null },
        })
        await emitRunStatus(r.id, RunStatus.RUNNING)
        await emitSystem(r.id, "input downloads complete; resuming run", LogLevel.INFO)
        continue
      }

      if (slots <= 0) continue

      for (const f of pending) {
        if (slots <= 0) break
        if (!f.url) {
          await prisma.inputFile.updateMany({
            where: { id: f.id },
            data: { status: "FAILED", error: "Missing URL" },
          })
          continue
        }
        const key = `${r.id}:${f.id}`
        if (params.inputDownloads.has(key)) continue
        void downloadUrlInputFile({
          inputDownloads: params.inputDownloads,
          runId: r.id,
          file: { id: f.id, name: f.name, url: f.url },
          finishRun: params.finishRun,
        })
        slots -= 1
      }
      continue
    }

    // Fallback (legacy runs): use initialInput.files.
    let parsedRaw: unknown
    try {
      parsedRaw = JSON.parse(r.initialInput || "{}")
    } catch {
      await params.finishRun(r.id, RunStatus.FAILED)
      await emitSystem(r.id, "invalid initialInput JSON; failing run", LogLevel.ERROR)
      continue
    }

    const parsed = isPlainObject(parsedRaw) ? parsedRaw : null
    const files: RunInputFile[] = Array.isArray(parsed?.files)
      ? (parsed!.files as unknown[]).filter(isRunInputFile)
      : []
    const anyFailed = files.some((f) => f.source === "url" && f.status === "failed")

    if (anyFailed) {
      await prisma.run.update({
        where: { id: r.id },
        data: {
          failureCode: "INPUT_DOWNLOAD_FAILED",
          failureMessage: "input download failed",
          failureMetaJson: JSON.stringify({ kind: "INPUT_DOWNLOAD_FAILED", legacy: true }),
          failureAt: new Date(),
        },
      })
      await params.finishRun(r.id, RunStatus.FAILED)
      continue
    }

    const pendingUrlFiles = files.filter(isUrlInputFile).filter((f) => f.status === "fetching" && !f.path)

    if (pendingUrlFiles.length === 0) {
      // All inputs ready => move to RUNNING (Path A: Jobs are the queue; runs should not go back to PENDING).
      await prisma.run.update({
        where: { id: r.id },
        data: { status: RunStatus.RUNNING, startedAt: r.startedAt ?? new Date(), finishedAt: null },
      })
      await emitRunStatus(r.id, RunStatus.RUNNING)
      await emitSystem(r.id, "input downloads complete; resuming run", LogLevel.INFO)
      continue
    }

    if (slots <= 0) continue

    for (const f of pendingUrlFiles) {
      if (slots <= 0) break
      const key = `${r.id}:${f.id}`
      if (params.inputDownloads.has(key)) continue
      void downloadUrlInputFile({
        inputDownloads: params.inputDownloads,
        runId: r.id,
        file: { id: f.id, name: f.name, url: f.url },
        finishRun: params.finishRun,
      })
      slots -= 1
    }
  }
}

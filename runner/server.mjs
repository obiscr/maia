import http from "node:http"
import crypto from "node:crypto"
import { URL } from "node:url"
import path from "node:path"

const PORT = Number(process.env.RUNNER_PORT ?? 9090) || 9090
const TOKEN = String(process.env.RUNNER_TOKEN ?? "").trim()
const DOCKER_SOCKET = String(process.env.DOCKER_SOCKET ?? "/var/run/docker.sock").trim() || "/var/run/docker.sock"
const DOCKER_API_VERSION_OVERRIDE = String(process.env.RUNNER_DOCKER_API_VERSION ?? "").trim()
const DOCKER_API_VERSION_FALLBACK = "v1.43"
const DATA_DIR = String(process.env.RUNNER_DATA_DIR ?? "/app/maia-data").trim() || "/app/maia-data"
const DATA_BIND = String(process.env.RUNNER_DATA_BIND ?? "").trim() // host path for bind mounts (recommended on Docker Desktop)
const DATA_VOLUME = String(process.env.RUNNER_DATA_VOLUME ?? "maia-data").trim() || "maia-data" // fallback if DATA_BIND not set
const ORPHAN_TTL_MS = Math.max(10_000, Number(process.env.RUNNER_ORPHAN_TTL_MS ?? 30 * 60 * 1000) || 30 * 60 * 1000)
const DEFAULT_STEP_IMAGE = String(process.env.RUNNER_STEP_IMAGE ?? "node:20-slim").trim() || "node:20-slim"
const DEFAULT_DEPS_IMAGE = String(process.env.RUNNER_DEPS_IMAGE ?? DEFAULT_STEP_IMAGE).trim() || DEFAULT_STEP_IMAGE
const DEFAULT_MOUNT_MODE = String(process.env.RUNNER_DEFAULT_MOUNT_MODE ?? "default").trim() || "default"
const DEBUG_RETAIN_FAILED = String(process.env.RUNNER_DEBUG_RETAIN_FAILED ?? "").trim() === "1"
const NOFILE = Math.max(0, Number(process.env.RUNNER_NOFILE ?? 4096) || 0)

function json(res, status, body) {
  const s = JSON.stringify(body ?? null)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(s),
  })
  res.end(s)
}

function unauthorized(res) {
  res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  res.end(JSON.stringify({ ok: false, code: "UNAUTHORIZED" }))
}

function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks = []
    req.on("data", (c) => {
      total += c.length
      if (total > limitBytes) {
        reject(new Error("BODY_TOO_LARGE"))
        try {
          req.destroy()
        } catch {}
        return
      }
      chunks.push(c)
    })
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      try {
        resolve(JSON.parse(raw || "{}"))
      } catch (e) {
        reject(e)
      }
    })
    req.on("error", reject)
  })
}

function dockerRequestRaw(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj != null ? Buffer.from(JSON.stringify(bodyObj), "utf8") : null
    const req = http.request(
      {
        method,
        socketPath: DOCKER_SOCKET,
        path,
        headers: body
          ? { "Content-Type": "application/json", "Content-Length": String(body.length) }
          : { "Content-Length": "0" },
      },
      (res) => {
        resolve(res)
      },
    )
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
}

function normalizeDockerApiVersion(v) {
  const s = String(v ?? "").trim()
  if (!s) return ""
  const core = s.startsWith("v") ? s.slice(1) : s
  // Accept versions like "1.44"
  if (!/^\d+\.\d+$/.test(core)) return ""
  return `v${core}`
}

function compareDockerApiVersion(a, b) {
  // Returns -1,0,1 for a<b, a==b, a>b (simple dotted decimals like 1.43)
  const pa = String(a ?? "")
    .replace(/^v/, "")
    .split(".")
    .map((x) => Number.parseInt(x, 10))
  const pb = String(b ?? "")
    .replace(/^v/, "")
    .split(".")
    .map((x) => Number.parseInt(x, 10))
  const a0 = Number.isFinite(pa[0]) ? pa[0] : 0
  const a1 = Number.isFinite(pa[1]) ? pa[1] : 0
  const b0 = Number.isFinite(pb[0]) ? pb[0] : 0
  const b1 = Number.isFinite(pb[1]) ? pb[1] : 0
  if (a0 !== b0) return a0 < b0 ? -1 : 1
  if (a1 !== b1) return a1 < b1 ? -1 : 1
  return 0
}

let dockerApiPrefixPromise = null
async function getDockerApiPrefix() {
  const overridden = normalizeDockerApiVersion(DOCKER_API_VERSION_OVERRIDE)
  if (overridden) return overridden

  if (!dockerApiPrefixPromise) {
    dockerApiPrefixPromise = (async () => {
      try {
        const res = await dockerRequestRaw("GET", "/version", null)
        const out = await readDockerJson(res).catch(() => null)
        const api = normalizeDockerApiVersion(out?.parsed?.ApiVersion ?? out?.parsed?.ApiVersion ?? "")
        const min = normalizeDockerApiVersion(out?.parsed?.MinAPIVersion ?? "")
        if (api && min) return compareDockerApiVersion(api, min) >= 0 ? api : min
        if (api) return api
        if (min) return min
      } catch {}
      return DOCKER_API_VERSION_FALLBACK
    })()
  }
  return dockerApiPrefixPromise
}

async function dockerRequest(method, path, bodyObj) {
  // Most endpoints in this file are versioned (historically hardcoded to /v1.43).
  // Docker daemon may reject older versions; negotiate once via /version.
  const prefix = await getDockerApiPrefix()
  const p = String(path ?? "")
  const rewritten = p.replace(/^\/v\d+\.\d+(?=\/)/, `/${prefix}`)
  return dockerRequestRaw(method, rewritten, bodyObj)
}

async function dockerRemoveContainer(id, force = true) {
  const qs = force ? "?force=1&v=1" : "?v=1"
  const res = await dockerRequest("DELETE", `/v1.43/containers/${encodeURIComponent(String(id))}${qs}`, null)
  // Always drain the response to avoid socket buildup.
  try {
    await readDockerJson(res)
  } catch {}
}

async function readDockerJson(res) {
  const chunks = []
  for await (const c of res) chunks.push(c)
  const raw = Buffer.concat(chunks).toString("utf8")
  const parsed = raw ? JSON.parse(raw) : null
  return { status: res.statusCode ?? 0, parsed, raw }
}

function writeNdjson(res, obj) {
  res.write(JSON.stringify(obj) + "\n")
}

function dataMount() {
  // Use bind mount when RUNNER_DATA_BIND is provided (best for macOS/Windows Docker Desktop).
  if (DATA_BIND) return { Type: "bind", Source: DATA_BIND, Target: DATA_DIR, ReadOnly: false }
  return { Type: "volume", Source: DATA_VOLUME, Target: DATA_DIR, ReadOnly: false }
}

function normalizeMountMode(v) {
  const s = String(v ?? "").trim()
  if (s === "strict") return "strict"
  return "default"
}

function bindSourceForTargetAbs(targetAbs) {
  // Convert a container absolute path under DATA_DIR into a host absolute path under DATA_BIND.
  // Example: targetAbs=/app/maia-data/runs/123 -> /host/maia-data/runs/123
  if (!DATA_BIND) return ""
  const t = String(targetAbs ?? "")
  if (!t.startsWith(DATA_DIR + "/")) return ""
  const rel = t.slice(DATA_DIR.length) // starts with "/..."
  return DATA_BIND.endsWith("/") ? DATA_BIND.slice(0, -1) + rel : DATA_BIND + rel
}

function bindMountForTargetAbs(targetAbs, readOnly) {
  const src = bindSourceForTargetAbs(targetAbs)
  if (!src) return null
  return { Type: "bind", Source: src, Target: String(targetAbs), ReadOnly: !!readOnly }
}

function isSafeUnderDataDir(p) {
  const s = String(p ?? "")
  if (!s) return false
  if (s.includes("\0")) return false
  // Must be absolute (container-style path).
  if (!s.startsWith("/")) return false
  // Normalize and require stability (no //, /./, /../, trailing /.., etc.).
  const norm = path.posix.normalize(s)
  if (norm !== s) return false
  // Must be under DATA_DIR (not equal to DATA_DIR itself).
  return s.startsWith(DATA_DIR + "/")
}

function clampInt(n, min, max) {
  const x = Number.isFinite(n) ? Math.floor(n) : min
  return Math.max(min, Math.min(max, x))
}

async function cleanupOrphansOnce() {
  const startedAt = Date.now()
  // Stop containers older than TTL with maia.kind label.
  // NOTE: Docker label filters are ANDed; asking for both "maia.kind=step" and "maia.kind=deps"
  // would match nothing. Instead, match any container that has the maia.kind label at all,
  // then decide what to do per-container.
  const filters = encodeURIComponent(JSON.stringify({ label: ["maia.kind"] }))
  const res = await dockerRequest("GET", `/v1.43/containers/json?all=1&filters=${filters}`, null)
  const out = await readDockerJson(res)
  if (out.status < 200 || out.status >= 300) return
  const arr = Array.isArray(out.parsed) ? out.parsed : []
  const now = Date.now()
  let removed = 0
  let failed = 0
  const firstErrors = []
  for (const c of arr) {
    const id = String(c?.Id ?? "")
    const createdSec = typeof c?.Created === "number" ? c.Created : 0
    const ageMs = now - createdSec * 1000
    if (!id) continue
    if (ageMs < ORPHAN_TTL_MS) continue
    try {
      // Force-remove will stop running containers and remove exited ones.
      await dockerRemoveContainer(id, true)
      removed += 1
    } catch (e) {
      failed += 1
      if (firstErrors.length < 3) firstErrors.push({ id, err: e instanceof Error ? e.message : String(e) })
    }
  }

  const durationMs = Date.now() - startedAt
  if (removed || failed) {
    console.log(
      JSON.stringify({
        level: failed ? "warn" : "info",
        event: "orphan_cleanup",
        ttlMs: ORPHAN_TTL_MS,
        removed,
        failed,
        durationMs,
        firstErrors: firstErrors.length ? firstErrors : undefined,
      }),
    )
  }
}

function parseMultiplexedDockerStream(stream, onFrame) {
  // Docker log stream for non-TTY containers is multiplexed:
  // [0]=streamType(1=stdout,2=stderr), [1..3]=0, [4..7]=uint32be payload length, then payload.
  let buf = Buffer.alloc(0)
  stream.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 8) {
      const type = buf[0]
      const len = buf.readUInt32BE(4)
      if (buf.length < 8 + len) break
      const payload = buf.subarray(8, 8 + len)
      buf = buf.subarray(8 + len)
      onFrame(type === 2 ? "stderr" : "stdout", payload)
    }
  })
}

function linesFromBytesFactory() {
  const carry = { stdout: "", stderr: "" }
  return (stream, payload) => {
    const prev = carry[stream] ?? ""
    const s = (prev + payload.toString("utf8")).replace(/\r\n/g, "\n")
    const parts = s.split("\n")
    carry[stream] = parts.pop() ?? ""
    return parts.map((x) => x.replace(/\r$/, ""))
  }
}

async function handleExecStep(req, res) {
  const execId = crypto.randomUUID()
  res.setHeader("x-maia-exec-id", execId)
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  })

  const body = await readJsonBody(req, 1024 * 1024).catch((e) => {
    writeNdjson(res, { type: "exit", exitCode: null, signal: null, error: String(e?.message ?? e) })
    res.end()
    return null
  })
  if (!body) return

  const runId = String(body.runId ?? "")
  const stepKey = String(body.stepKey ?? "")
  const attemptNo = Number(body.attemptNo ?? 0)
  const mountMode = normalizeMountMode(body.mountMode ?? DEFAULT_MOUNT_MODE)
  const mounts = body.mounts ?? {}
  const attemptAbs = String(mounts.attemptAbs ?? "")
  const depsAbs = String(mounts.depsAbs ?? "")
  const runAbs = mounts.runAbs != null ? String(mounts.runAbs) : ""

  // Security: enforce fixed image; do not allow caller override.
  const image = DEFAULT_STEP_IMAGE
  const envObj = body.env && typeof body.env === "object" ? body.env : {}
  const env = Object.entries(envObj)
    .filter(([k, v]) => typeof k === "string" && k.length && typeof v === "string")
    .map(([k, v]) => `${k}=${v}`)

  if (!isSafeUnderDataDir(attemptAbs) || !isSafeUnderDataDir(depsAbs) || (runAbs && !isSafeUnderDataDir(runAbs))) {
    writeNdjson(res, { type: "log", stream: "stderr", line: "invalid mounts (not under data dir)" })
    writeNdjson(res, { type: "exit", exitCode: null, signal: null })
    res.end()
    return
  }

  let containerMounts = [dataMount()]
  if (mountMode === "strict") {
    if (!DATA_BIND) {
      writeNdjson(res, {
        type: "log",
        stream: "stderr",
        line: "strict mount mode requires RUNNER_DATA_BIND (bind-mount host data dir)",
      })
      writeNdjson(res, { type: "exit", exitCode: null, signal: null })
      res.end()
      return
    }
    const mRun = runAbs ? bindMountForTargetAbs(runAbs, true) : null
    const mAttempt = bindMountForTargetAbs(attemptAbs, false)
    const mDeps = bindMountForTargetAbs(depsAbs, true)
    if ((runAbs && !mRun) || !mAttempt || !mDeps) {
      writeNdjson(res, {
        type: "log",
        stream: "stderr",
        line: "strict mounts could not be derived from RUNNER_DATA_BIND",
      })
      writeNdjson(res, { type: "exit", exitCode: null, signal: null })
      res.end()
      return
    }
    // Order matters: mount broader RO first, then overlay narrower RW (attempt).
    containerMounts = []
    if (mRun) containerMounts.push(mRun)
    containerMounts.push(mDeps)
    containerMounts.push(mAttempt)
  }

  const labels = {
    "maia.execId": execId,
    "maia.kind": "step",
    "maia.runId": runId,
    "maia.stepKey": stepKey,
    "maia.attemptNo": String(attemptNo),
    "maia.mountMode": mountMode,
    // When debug-retain is enabled, tag containers for easier filtering/cleanup.
    ...(DEBUG_RETAIN_FAILED ? { "maia.debugRetain": "1" } : {}),
  }

  const memoryMb = typeof body?.limits?.memoryMb === "number" ? body.limits.memoryMb : 0
  const cpus = typeof body?.limits?.cpus === "number" ? body.limits.cpus : 0
  const pids = typeof body?.limits?.pids === "number" ? body.limits.pids : 0
  const memBytes = memoryMb ? clampInt(memoryMb, 16, 8192) * 1024 * 1024 : 0
  const nanoCpus = cpus ? clampInt(cpus * 1000, 1, 128000) * 1_000_000 : 0 // ~0.001..128 CPUs
  const pidsLimit = pids ? clampInt(pids, 8, 100000) : 0

  const createBody = {
    Image: image,
    Cmd: ["node", `${attemptAbs}/runner.mjs`],
    WorkingDir: depsAbs,
    Env: env,
    Tty: false,
    OpenStdin: false,
    Labels: labels,
    HostConfig: {
      AutoRemove: false,
      Mounts: containerMounts,
      ReadonlyRootfs: true,
      NetworkMode: "bridge",
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL"],
      Ulimits: NOFILE ? [{ Name: "nofile", Soft: NOFILE, Hard: NOFILE }] : undefined,
      // Resource limits (best-effort; optional)
      Memory: memBytes,
      NanoCpus: nanoCpus,
      PidsLimit: pidsLimit,
    },
    User: "65532:65532",
  }

  // Create container
  const createRes = await dockerRequest("POST", "/v1.43/containers/create", createBody)
  const created = await readDockerJson(createRes)
  if (created.status < 200 || created.status >= 300) {
    const detail = created.raw || String(created.status)
    const msg = `docker create failed: ${detail}`
    writeNdjson(res, { type: "log", stream: "stderr", line: msg })
    writeNdjson(res, { type: "exit", exitCode: null, signal: null, error: msg })
    res.end()
    return
  }

  const containerId = String(created.parsed?.Id ?? "")
  if (!containerId) {
    writeNdjson(res, { type: "log", stream: "stderr", line: "docker create missing container id" })
    writeNdjson(res, { type: "exit", exitCode: null, signal: null })
    res.end()
    return
  }

  const startedAt = Date.now()
  console.log(
    JSON.stringify({
      level: "info",
      event: "exec_start",
      kind: "step",
      execId,
      containerId,
      image,
      mountMode,
      runId,
      stepKey,
      attemptNo,
    }),
  )

  // Start container
  const startRes = await dockerRequest("POST", `/v1.43/containers/${encodeURIComponent(containerId)}/start`, null)
  if ((startRes.statusCode ?? 0) < 200 || (startRes.statusCode ?? 0) >= 300) {
    const started = await readDockerJson(startRes)
    const detail = started.raw || String(started.status)
    const msg = `docker start failed: ${detail}`
    writeNdjson(res, { type: "log", stream: "stderr", line: msg })
    writeNdjson(res, { type: "exit", exitCode: null, signal: null, error: msg })
    res.end()
    return
  }

  // Stream logs (follow)
  const logsRes = await dockerRequest(
    "GET",
    `/v1.43/containers/${encodeURIComponent(containerId)}/logs?follow=1&stdout=1&stderr=1&timestamps=0`,
    null,
  )

  const toLines = linesFromBytesFactory()
  parseMultiplexedDockerStream(logsRes, (streamName, payload) => {
    const lines = toLines(streamName, payload)
    for (const line of lines) {
      if (!line) continue
      writeNdjson(res, { type: "log", stream: streamName, line })
    }
  })

  // Wait for container exit
  const waitRes = await dockerRequest("POST", `/v1.43/containers/${encodeURIComponent(containerId)}/wait`, {
    condition: "not-running",
  })
  const waited = await readDockerJson(waitRes).catch(() => null)
  const statusCode = waited && typeof waited.parsed?.StatusCode === "number" ? waited.parsed.StatusCode : null

  // Keep failed containers only when explicitly enabled; otherwise remove.
  const okExit = statusCode === 0
  const durationMs = Date.now() - startedAt
  const retained = !okExit && DEBUG_RETAIN_FAILED
  if (!okExit && DEBUG_RETAIN_FAILED) {
    writeNdjson(res, {
      type: "log",
      stream: "stderr",
      line: `[runner] retained failed step container id=${containerId}`,
    })
  } else {
    try {
      await dockerRemoveContainer(containerId, true)
    } catch {}
  }

  console.log(
    JSON.stringify({
      level: okExit ? "info" : "warn",
      event: "exec_end",
      kind: "step",
      execId,
      containerId,
      image,
      mountMode,
      runId,
      stepKey,
      attemptNo,
      durationMs,
      exitCode: statusCode,
      retained,
    }),
  )

  // Best-effort: flush remaining log fragments by sending them as lines.
  // (We skip emitting partial tails to keep UI consistent with line-based logs.)

  writeNdjson(res, { type: "exit", exitCode: statusCode, signal: null })
  res.end()
}

async function handleExecDeps(req, res) {
  const execId = crypto.randomUUID()
  res.setHeader("x-maia-exec-id", execId)
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  })

  const body = await readJsonBody(req, 1024 * 1024).catch((e) => {
    writeNdjson(res, { type: "exit", exitCode: null, signal: null, error: String(e?.message ?? e) })
    res.end()
    return null
  })
  if (!body) return

  const workflowId = String(body.workflowId ?? "")
  const depsHash = String(body.depsHash ?? "")
  const depsDirAbs = String(body.depsDirAbs ?? "")
  const mountMode = normalizeMountMode(body.mountMode ?? DEFAULT_MOUNT_MODE)

  if (!depsDirAbs) {
    writeNdjson(res, { type: "log", stream: "stderr", line: "invalid depsDirAbs" })
    writeNdjson(res, { type: "exit", exitCode: null, signal: null })
    res.end()
    return
  }

  // Security: enforce fixed image; do not allow caller override.
  const image = DEFAULT_DEPS_IMAGE
  const envObj = body.env && typeof body.env === "object" ? body.env : {}
  const env = Object.entries(envObj)
    .filter(([k, v]) => typeof k === "string" && k.length && typeof v === "string")
    .map(([k, v]) => `${k}=${v}`)

  if (!isSafeUnderDataDir(depsDirAbs)) {
    writeNdjson(res, { type: "log", stream: "stderr", line: "invalid depsDirAbs (not under data dir)" })
    writeNdjson(res, { type: "exit", exitCode: null, signal: null })
    res.end()
    return
  }

  let containerMounts = [dataMount()]
  if (mountMode === "strict") {
    if (!DATA_BIND) {
      writeNdjson(res, {
        type: "log",
        stream: "stderr",
        line: "strict mount mode requires RUNNER_DATA_BIND (bind-mount host data dir)",
      })
      writeNdjson(res, { type: "exit", exitCode: null, signal: null })
      res.end()
      return
    }
    const mDepsRw = bindMountForTargetAbs(depsDirAbs, false)
    if (!mDepsRw) {
      writeNdjson(res, {
        type: "log",
        stream: "stderr",
        line: "strict deps mount could not be derived from RUNNER_DATA_BIND",
      })
      writeNdjson(res, { type: "exit", exitCode: null, signal: null })
      res.end()
      return
    }
    containerMounts = [mDepsRw]
  }

  // Ensure corepack cache lives on a writable directory (within deps dir on the shared volume).
  env.push(`COREPACK_HOME=${depsDirAbs}/.corepack`)
  env.push(`PNPM_HOME=${depsDirAbs}/.pnpm`)
  env.push(`PNPM_STORE_DIR=${depsDirAbs}/.pnpm-store`)

  const labels = {
    "maia.execId": execId,
    "maia.kind": "deps",
    "maia.workflowId": workflowId,
    "maia.depsHash": depsHash,
    "maia.mountMode": mountMode,
    ...(DEBUG_RETAIN_FAILED ? { "maia.debugRetain": "1" } : {}),
  }

  const memoryMb = typeof body?.limits?.memoryMb === "number" ? body.limits.memoryMb : 0
  const cpus = typeof body?.limits?.cpus === "number" ? body.limits.cpus : 0
  const pids = typeof body?.limits?.pids === "number" ? body.limits.pids : 0
  const memBytes = memoryMb ? clampInt(memoryMb, 16, 8192) * 1024 * 1024 : 0
  const nanoCpus = cpus ? clampInt(cpus * 1000, 1, 128000) * 1_000_000 : 0 // ~0.001..128 CPUs
  const pidsLimit = pids ? clampInt(pids, 8, 100000) : 0

  const createBody = {
    Image: image,
    Cmd: ["sh", "-lc", `cd ${depsDirAbs} && corepack pnpm install --prod --ignore-scripts --no-frozen-lockfile`],
    WorkingDir: depsDirAbs,
    Env: env,
    Tty: false,
    OpenStdin: false,
    Labels: labels,
    HostConfig: {
      AutoRemove: false,
      Mounts: containerMounts,
      ReadonlyRootfs: true,
      NetworkMode: "bridge",
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL"],
      Ulimits: NOFILE ? [{ Name: "nofile", Soft: NOFILE, Hard: NOFILE }] : undefined,
      Memory: memBytes,
      NanoCpus: nanoCpus,
      PidsLimit: pidsLimit,
    },
    User: "65532:65532",
  }

  const createRes = await dockerRequest("POST", "/v1.43/containers/create", createBody)
  const created = await readDockerJson(createRes)
  if (created.status < 200 || created.status >= 300) {
    const detail = created.raw || String(created.status)
    const msg = `docker create failed: ${detail}`
    writeNdjson(res, { type: "log", stream: "stderr", line: msg })
    writeNdjson(res, { type: "exit", exitCode: null, signal: null, error: msg })
    res.end()
    return
  }

  const containerId = String(created.parsed?.Id ?? "")
  if (!containerId) {
    writeNdjson(res, { type: "log", stream: "stderr", line: "docker create missing container id" })
    writeNdjson(res, { type: "exit", exitCode: null, signal: null })
    res.end()
    return
  }

  const startedAt = Date.now()
  console.log(
    JSON.stringify({
      level: "info",
      event: "exec_start",
      kind: "deps",
      execId,
      containerId,
      image,
      mountMode,
      workflowId,
      depsHash,
    }),
  )

  const startRes = await dockerRequest("POST", `/v1.43/containers/${encodeURIComponent(containerId)}/start`, null)
  if ((startRes.statusCode ?? 0) < 200 || (startRes.statusCode ?? 0) >= 300) {
    const started = await readDockerJson(startRes)
    const detail = started.raw || String(started.status)
    const msg = `docker start failed: ${detail}`
    writeNdjson(res, { type: "log", stream: "stderr", line: msg })
    writeNdjson(res, { type: "exit", exitCode: null, signal: null, error: msg })
    res.end()
    return
  }

  const logsRes = await dockerRequest(
    "GET",
    `/v1.43/containers/${encodeURIComponent(containerId)}/logs?follow=1&stdout=1&stderr=1&timestamps=0`,
    null,
  )

  const toLines = linesFromBytesFactory()
  parseMultiplexedDockerStream(logsRes, (streamName, payload) => {
    const lines = toLines(streamName, payload)
    for (const line of lines) {
      if (!line) continue
      writeNdjson(res, { type: "log", stream: streamName, line })
    }
  })

  const waitRes = await dockerRequest("POST", `/v1.43/containers/${encodeURIComponent(containerId)}/wait`, {
    condition: "not-running",
  })
  const waited = await readDockerJson(waitRes).catch(() => null)
  const statusCode = waited && typeof waited.parsed?.StatusCode === "number" ? waited.parsed.StatusCode : null

  const okExit = statusCode === 0
  const durationMs = Date.now() - startedAt
  const retained = !okExit && DEBUG_RETAIN_FAILED
  if (!okExit && DEBUG_RETAIN_FAILED) {
    writeNdjson(res, {
      type: "log",
      stream: "stderr",
      line: `[runner] retained failed deps container id=${containerId}`,
    })
  } else {
    try {
      await dockerRemoveContainer(containerId, true)
    } catch {}
  }

  console.log(
    JSON.stringify({
      level: okExit ? "info" : "warn",
      event: "exec_end",
      kind: "deps",
      execId,
      containerId,
      image,
      mountMode,
      workflowId,
      depsHash,
      durationMs,
      exitCode: statusCode,
      retained,
    }),
  )

  writeNdjson(res, { type: "exit", exitCode: statusCode, signal: null })
  res.end()
}

async function findContainerByExecId(execId) {
  const filters = encodeURIComponent(JSON.stringify({ label: [`maia.execId=${execId}`] }))
  const res = await dockerRequest("GET", `/v1.43/containers/json?all=1&filters=${filters}`, null)
  const out = await readDockerJson(res)
  if (out.status < 200 || out.status >= 300) return null
  const arr = Array.isArray(out.parsed) ? out.parsed : []
  const id = arr.length ? String(arr[0]?.Id ?? "") : ""
  return id || null
}

async function handleCancel(req, res, execId) {
  const body = await readJsonBody(req, 128 * 1024).catch(() => ({}))
  const mode = String(body.mode ?? "stop") === "kill" ? "kill" : "stop"
  const containerId = await findContainerByExecId(execId)
  if (!containerId) {
    console.log(JSON.stringify({ level: "warn", event: "exec_cancel", execId, found: false, mode }))
    return json(res, 404, { ok: false, code: "NOT_FOUND" })
  }

  if (mode === "kill") {
    const r = await dockerRequest("POST", `/v1.43/containers/${encodeURIComponent(containerId)}/kill`, null)
    const st = r.statusCode ?? 0
    try {
      await readDockerJson(r)
    } catch {}
    console.log(
      JSON.stringify({
        level: st >= 200 && st < 300 ? "info" : "warn",
        event: "exec_cancel",
        execId,
        found: true,
        mode,
        containerId,
        status: st,
      }),
    )
    return json(res, st >= 200 && st < 300 ? 200 : 500, { ok: st >= 200 && st < 300 })
  }

  const r = await dockerRequest("POST", `/v1.43/containers/${encodeURIComponent(containerId)}/stop?t=10`, null)
  const st = r.statusCode ?? 0
  try {
    await readDockerJson(r)
  } catch {}
  console.log(
    JSON.stringify({
      level: st >= 200 && st < 300 ? "info" : "warn",
      event: "exec_cancel",
      execId,
      found: true,
      mode,
      containerId,
      status: st,
    }),
  )
  return json(res, st >= 200 && st < 300 ? 200 : 500, { ok: st >= 200 && st < 300 })
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://local")

  if (u.pathname === "/healthz") {
    return json(res, 200, { ok: true })
  }

  if (!TOKEN) {
    return json(res, 500, { ok: false, code: "RUNNER_TOKEN_MISSING" })
  }

  const auth = String(req.headers.authorization ?? "")
  const okAuth = auth.startsWith("Bearer ") && auth.slice("Bearer ".length).trim() === TOKEN
  if (!okAuth) return unauthorized(res)

  try {
    if (req.method === "POST" && u.pathname === "/v1/exec/step") {
      return await handleExecStep(req, res)
    }
    if (req.method === "POST" && u.pathname === "/v1/exec/deps") {
      return await handleExecDeps(req, res)
    }

    const m = u.pathname.match(/^\/v1\/exec\/([^/]+)\/cancel$/)
    if (req.method === "POST" && m) {
      return await handleCancel(req, res, decodeURIComponent(m[1] || ""))
    }
  } catch (e) {
    return json(res, 500, { ok: false, code: "INTERNAL_ERROR", detail: e instanceof Error ? e.message : String(e) })
  }

  json(res, 404, { ok: false, code: "NOT_FOUND" })
})

server.listen(PORT, () => {
  console.log(`[runner] listening on :${PORT} (docker socket: ${DOCKER_SOCKET})`)
})

// Background orphan cleanup (best-effort).
setInterval(
  () => {
    cleanupOrphansOnce().catch(() => {})
  },
  Math.max(10_000, Math.floor(ORPHAN_TTL_MS / 2)),
)

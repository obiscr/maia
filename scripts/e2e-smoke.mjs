#!/usr/bin/env node
/**
 * Minimal integration smoke test (no extra deps):
 * - Start the built server on a random port (requires `pnpm build` already done)
 * - Create a workflow via API
 * - Create a job via API
 * - Poll until job reaches terminal status (SUCCEEDED)
 * - Cleanup (delete job + workflow)
 */
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import os from "os"

const PORT = String(3456 + Math.floor(Math.random() * 1000))
const BASE = `http://127.0.0.1:${PORT}`

const READY_TIMEOUT_MS = Number(process.env.E2E_READY_TIMEOUT_MS ?? 30_000)
const JOB_TIMEOUT_MS = Number(process.env.E2E_JOB_TIMEOUT_MS ?? 60_000)
const OP_TIMEOUT_MS = Number(process.env.E2E_OPERATION_TIMEOUT_MS ?? 60_000)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function die(msg) {
  console.error(`[e2e] ❌ ${msg}`)
  process.exit(1)
}

/**
 * When running the Next.js standalone server, the runtime cwd may not be the repo root,
 * so the API route `/api/setup/initialize-db` may not be able to locate Prisma CLI.
 *
 * To keep this smoke test self-contained, we can run migrations from the script itself
 * (still using the project-pinned Prisma version via pnpm), then retry the API call.
 */
function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts })
    child.on("exit", (code) => resolve(typeof code === "number" ? code : 1))
    child.on("error", () => resolve(1))
  })
}

class CookieJar {
  constructor() {
    /** @type {Map<string, string>} */
    this.map = new Map()
  }
  /** @param {Response} res */
  absorb(res) {
    /** @type {string[]} */
    let setCookies = []
    // Node/undici provides getSetCookie(); fall back for older runtimes.
    if (res?.headers && typeof res.headers.getSetCookie === "function") {
      setCookies = res.headers.getSetCookie()
    } else {
      const sc = res?.headers?.get?.("set-cookie")
      if (sc) setCookies = [sc]
    }

    for (const raw of setCookies) {
      const first = String(raw ?? "").split(";")[0] ?? ""
      const idx = first.indexOf("=")
      if (idx <= 0) continue
      const name = first.slice(0, idx).trim()
      const value = first.slice(idx + 1).trim()
      if (!name) continue
      this.map.set(name, value)
    }
  }
  header() {
    const parts = []
    for (const [k, v] of this.map.entries()) parts.push(`${k}=${v}`)
    return parts.join("; ")
  }
}

/** @type {CookieJar | null} */
let cookieJar = null

/** @type {string} */
let e2eDataDir = ""

async function fetchJson(path, init) {
  const headers = new Headers(init?.headers ?? {})
  if (cookieJar) {
    const h = cookieJar.header()
    if (h) headers.set("Cookie", h)
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (cookieJar) cookieJar.absorb(res)
  const text = await res.text().catch(() => "")
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // ignore
  }
  if (!res.ok) {
    const code = json && typeof json.code === "string" ? json.code : "HTTP_ERROR"
    throw new Error(`${path} failed: HTTP ${res.status} code=${code} body=${text.slice(0, 500)}`)
  }
  return json
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastErr = ""
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`, { redirect: "manual" })
      if (res.status === 200 || res.status === 307 || res.status === 308) return
      lastErr = `status=${res.status}`
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
    await sleep(250)
  }
  die(`server not ready in time (${lastErr})`)
}

async function ensureSchemaInitialized() {
  if (!e2eDataDir) throw new Error("internal error: e2eDataDir not set")

  // In production, migrations are run by the dedicated `migrator` container/job.
  // For this local smoke test, we run migrations directly against the ephemeral MAIA_DATA_DIR
  // so the test does not depend on docker-compose orchestration.
  console.log("[e2e] running pnpm prisma:migrate for ephemeral instance")
  const code = await runCmd("pnpm", ["prisma:migrate"], {
    env: { ...process.env, MAIA_DATA_DIR: e2eDataDir, MAIA_IN_CONTAINER: "0" },
  })
  if (code !== 0) throw new Error(`pnpm prisma:migrate failed with exit code ${code}`)
}

async function ensureAuthed() {
  // Ensure schema exists for the (temp) instance before any auth/db calls.
  await ensureSchemaInitialized()

  const email = String(process.env.E2E_EMAIL ?? "e2e-admin@example.com")
  const password = String(process.env.E2E_PASSWORD ?? "e2e-password-please-change")

  // If this is a fresh instance, /api/auth/setup will create the first admin and set a session cookie.
  // If already initialized, fall back to signin.
  try {
    await fetchJson("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: "E2E Admin" }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes("HTTP 409") || !msg.includes("ALREADY_INITIALIZED")) throw e
    await fetchJson("/api/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  }

  const st = await fetchJson("/api/auth/status", { method: "GET" })
  if (!st?.user) throw new Error("auth status returned no user after login")
}

async function pollJob(jobId, opts = {}) {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : JOB_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  let lastStatus = ""
  while (Date.now() < deadline) {
    const j = await fetchJson(`/api/jobs/${jobId}`, { method: "GET" })
    const status = j?.job?.status ?? ""
    lastStatus = String(status)
    if (status === "SUCCEEDED") return j
    if (status === "FAILED" || status === "CANCELED") {
      throw new Error(`job ended with status=${status}`)
    }
    await sleep(300)
  }
  throw new Error(`timed out waiting for job to finish (lastStatus=${lastStatus})`)
}

async function pollOperation(operationId, opts = {}) {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : OP_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  let lastStatus = ""
  let lastProgress = ""
  while (Date.now() < deadline) {
    const j = await fetchJson(`/api/operations/${operationId}`, { method: "GET" })
    const op = j?.operation
    const status = String(op?.status ?? "")
    lastStatus = status
    const p = op?.progress
    if (p && (p.message || p.total != null)) {
      lastProgress = `progress=${String(p.current ?? 0)}/${String(p.total ?? "?")} msg=${String(p.message ?? "")}`
    }
    if (status === "SUCCEEDED") {
      if (op?.result) return op.result
      // Some operations mark SUCCEEDED slightly before the stored reply is readable.
    }
    if (status === "FAILED") {
      const err = op?.error
      const code = err?.code ? String(err.code) : "OPERATION_FAILED"
      const msg = err?.message ? String(err.message) : ""
      throw new Error(`operation failed code=${code} ${msg}`.trim())
    }
    await sleep(300)
  }
  throw new Error(`timed out waiting for operation (lastStatus=${lastStatus} ${lastProgress})`)
}

function makeScriptEsm() {
  return [
    "export default {",
    "  async main(_env, _ctx) {",
    "    return { outputs: { ok: true, at: Date.now() } };",
    "  },",
    "};",
    "",
  ].join("\n")
}

async function createWorkflow({ name, description, inputSpec } = {}) {
  const createWf = await fetchJson("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description,
      dependencies: "{}",
      ...(inputSpec ? { inputSpec } : {}),
      steps: [{ stepKey: "s1", name: "step 1", scriptEsm: makeScriptEsm(), deps: [], timeoutMs: 30_000 }],
    }),
  })
  const wf = createWf?.workflow
  if (!wf?.id) throw new Error("workflow create returned no id")
  return String(wf.id)
}

async function main() {
  console.log(`[e2e] starting server on ${BASE}`)
  cookieJar = new CookieJar()

  // Use an isolated instance dir so e2e doesn't depend on (or mutate) a developer's local data dir.
  e2eDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "maia-e2e-"))

  // Prefer standalone output when `output: "standalone"` is enabled.
  const standaloneServer = path.join(process.cwd(), ".next", "standalone", "server.js")
  // If standalone isn't present (no build), fall back to `next start`.
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next")
  const cmd = await (async () => {
    try {
      await fs.stat(standaloneServer)
      return { argv: [standaloneServer], kind: "standalone" }
    } catch {
      return { argv: [nextBin, "start", "-p", PORT], kind: "next-start" }
    }
  })()

  const child = spawn(process.execPath, cmd.argv, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT, MAIA_DATA_DIR: e2eDataDir, MAIA_IN_CONTAINER: "0" },
  })

  let serverLog = ""
  child.stdout.on("data", (b) => {
    const s = b.toString("utf8")
    serverLog += s
    if (serverLog.length > 20_000) serverLog = serverLog.slice(-20_000)
  })
  child.stderr.on("data", (b) => {
    const s = b.toString("utf8")
    serverLog += s
    if (serverLog.length > 20_000) serverLog = serverLog.slice(-20_000)
  })

  const cleanupServer = async () => {
    if (child.exitCode != null) return
    child.kill("SIGTERM")
    await Promise.race([new Promise((r) => child.once("exit", r)), sleep(3000)])
    if (child.exitCode == null) child.kill("SIGKILL")
  }

  try {
    await waitForReady()
    await ensureAuthed()

    const cleanup = []
    const addCleanup = (fn) => cleanup.push(fn)
    const runCase = async (name, fn) => {
      const started = Date.now()
      console.log(`[e2e] [case] ${name}`)
      await fn()
      const ms = Date.now() - started
      console.log(`[e2e] [case] ${name} ✅ (${ms}ms)`)
    }

    let passed = 0

    // --- Case 1: happy path (workflow -> job -> SUCCEEDED)
    await runCase("jobs: create + run to SUCCEEDED", async () => {
      const wid = crypto.randomUUID().slice(0, 8)
      const wfId = await createWorkflow({
        name: `e2e-ok-${wid}`,
        description: "e2e smoke workflow (ok)",
      })
      addCleanup(() => fetchJson(`/api/workflows/${wfId}`, { method: "DELETE" }).catch(() => {}))

      const createJob = await fetchJson("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: wfId, inputJson: {}, start: true }),
      })
      const job = createJob?.job
      if (!job?.id) throw new Error("job create returned no id")
      const jobId = String(job.id)
      addCleanup(() => fetchJson(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {}))

      console.log(`[e2e] [jobs] workflow=${wfId} job=${jobId}, waiting...`)
      await pollJob(jobId)
      passed += 1
    })

    // --- Case 2: validation failure (inputSpec requires a field)
    await runCase("jobs: inputSpec validation (expect 422 INVALID_INITIAL_INPUT)", async () => {
      const wid = crypto.randomUUID().slice(0, 8)
      const inputSpec = {
        version: 1,
        paramsSchema: {
          type: "object",
          additionalProperties: false,
          properties: { foo: { type: "string" } },
          required: ["foo"],
        },
      }
      const wfId = await createWorkflow({
        name: `e2e-invalid-${wid}`,
        description: "e2e smoke workflow (invalid input)",
        inputSpec: JSON.stringify(inputSpec, null, 2),
      })
      addCleanup(() => fetchJson(`/api/workflows/${wfId}`, { method: "DELETE" }).catch(() => {}))

      try {
        const res = await fetchJson("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId: wfId, inputJson: {}, start: true }),
        })
        throw new Error(`expected validation error, but got success: ${JSON.stringify(res).slice(0, 200)}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!msg.includes("HTTP 422") || !msg.includes("INVALID_INITIAL_INPUT")) {
          throw new Error(`expected 422 INVALID_INITIAL_INPUT, got: ${msg}`)
        }
      }
      passed += 1
    })

    // --- Case 3: schedules run-now (schedule -> run-now -> job -> SUCCEEDED)
    await runCase("schedules: create + run-now -> job SUCCEEDED", async () => {
      const wid = crypto.randomUUID().slice(0, 8)
      const wfId = await createWorkflow({
        name: `e2e-sched-${wid}`,
        description: "e2e smoke schedule workflow",
      })
      addCleanup(() => fetchJson(`/api/workflows/${wfId}`, { method: "DELETE" }).catch(() => {}))

      const createSchedule = await fetchJson("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `e2e-sched-${wid}`,
          workflowId: wfId,
          kind: "INTERVAL",
          intervalMs: 60_000,
          enabled: true,
          inputJson: {},
        }),
      })
      const sched = createSchedule?.schedule
      if (!sched?.id) throw new Error("schedule create returned no id")
      const scheduleId = String(sched.id)
      addCleanup(() => fetchJson(`/api/schedules/${scheduleId}`, { method: "DELETE" }).catch(() => {}))

      const runNow = await fetchJson(`/api/schedules/${scheduleId}/run-now`, { method: "POST" })
      const jobId = runNow?.jobId ? String(runNow.jobId) : ""
      if (!jobId) throw new Error("run-now returned no jobId")
      addCleanup(() => fetchJson(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {}))

      console.log(`[e2e] [schedules] schedule=${scheduleId} job=${jobId}, waiting...`)
      await pollJob(jobId)
      passed += 1
    })

    // --- Case 4: batches enqueue jobs (batch -> async enqueue -> poll operation -> job(s) SUCCEEDED)
    await runCase("batches: create + enqueue jobs -> job(s) SUCCEEDED", async () => {
      const wid = crypto.randomUUID().slice(0, 8)
      const wfId = await createWorkflow({
        name: `e2e-batch-${wid}`,
        description: "e2e smoke batch workflow",
      })
      addCleanup(() => fetchJson(`/api/workflows/${wfId}`, { method: "DELETE" }).catch(() => {}))

      const createBatch = await fetchJson("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `e2e-batch-${wid}`,
          workflowId: wfId,
          sourceJson: { source: "e2e-smoke" },
          failFast: false,
        }),
      })
      const batch = createBatch?.batch
      if (!batch?.id) throw new Error("batch create returned no id")
      const batchId = String(batch.id)
      addCleanup(() => fetchJson(`/api/batches/${batchId}`, { method: "DELETE" }).catch(() => {}))

      const enqueue = await fetchJson(`/api/batches/${batchId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ n: 1 }, { n: 2 }], start: true }),
      })
      const operationId = enqueue?.operationId ? String(enqueue.operationId) : ""
      if (!operationId) throw new Error("batch jobs enqueue returned no operationId")

      const result = await pollOperation(operationId)
      const jobIds = Array.isArray(result?.body?.jobIds) ? result.body.jobIds.map(String) : []
      if (jobIds.length === 0) throw new Error("operation result returned no jobIds")

      // Poll a small sample (we enqueue 2 items; poll both).
      for (const jobId of jobIds.slice(0, 2)) {
        addCleanup(() => fetchJson(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {}))
        console.log(`[e2e] [batches] batch=${batchId} job=${jobId}, waiting...`)
        await pollJob(jobId)
      }
      passed += 1
    })

    console.log("[e2e] cleaning up...")
    for (const fn of cleanup.reverse()) await fn()

    console.log(`[e2e] ✅ OK (${passed} cases)`)
  } catch (e) {
    console.error("[e2e] failure:", e)
    console.error("\n[e2e] server log tail:\n" + serverLog)
    process.exitCode = 1
  } finally {
    await cleanupServer()
    try {
      await fs.rm(e2eDataDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))

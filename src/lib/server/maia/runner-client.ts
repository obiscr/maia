import "server-only"

type RunnerLogEvent = { type: "log"; stream: "stdout" | "stderr"; line: string }
type RunnerExitEvent = { type: "exit"; exitCode: number | null; signal: string | null; error?: string | null }
type RunnerEvent = RunnerLogEvent | RunnerExitEvent | { type: string; [k: string]: unknown }

export type RunnerMountMode = "default" | "strict"

function parseExitEvent(ev: unknown): RunnerExitEvent | null {
  if (!ev || typeof ev !== "object") return null
  const o = ev as Record<string, unknown>
  if (o.type !== "exit") return null
  return {
    type: "exit",
    exitCode: typeof o.exitCode === "number" ? o.exitCode : null,
    signal: typeof o.signal === "string" ? String(o.signal) : null,
    error: typeof o.error === "string" ? String(o.error) : null,
  }
}

export type RunnerStepExecRequest = {
  runId: string
  stepKey: string
  attemptNo: number
  /**
   * Mount strategy for the sandbox container.
   * - default: mount whole maia-data (cross-platform; current behavior)
   * - strict: minimal mounts (requires bind-mount mode on Runner)
   */
  mountMode?: RunnerMountMode
  mounts: { attemptAbs: string; depsAbs: string; runAbs?: string | null }
  limits: { timeoutMs: number; cpus?: number; memoryMb?: number; pids?: number }
  env: Record<string, string>
}

export type RunnerDepsExecRequest = {
  workflowId: string
  depsHash: string
  depsDirAbs: string
  /**
   * Mount strategy for the deps-install sandbox container.
   * See RunnerStepExecRequest.mountMode.
   */
  mountMode?: RunnerMountMode
  limits?: { timeoutMs?: number; cpus?: number; memoryMb?: number; pids?: number }
  env: Record<string, string>
}

export function getRunnerConfigFromEnv(): { ok: true; url: string; token: string } | { ok: false; reason: "missing" } {
  const url = String(process.env.RUNNER_URL ?? "").trim()
  const token = String(process.env.RUNNER_TOKEN ?? "").trim()
  if (!url || !token) return { ok: false, reason: "missing" }
  return { ok: true, url, token }
}

export function buildStepExecEnv(params: {
  workflowEnv: Record<string, string>
  maia: {
    runId: string
    stepKey: string
    attemptNo: number
    inputPath: string
    outputPath: string
    runDir: string
    attemptDir: string
    workflowId: string
    depsHash: string
  }
}): Record<string, string> {
  const out: Record<string, string> = {}

  // Workflow env (explicitly configured).
  for (const [k, v] of Object.entries(params.workflowEnv ?? {})) {
    if (!k) continue
    // Never allow workflow env to override platform context keys.
    if (String(k).startsWith("MAIA_")) continue
    if (typeof v !== "string") continue
    out[String(k)] = v
  }

  // Platform allowlist.
  out.MAIA_RUN_ID = params.maia.runId
  out.MAIA_STEP_KEY = params.maia.stepKey
  out.MAIA_ATTEMPT_NO = String(params.maia.attemptNo)
  out.MAIA_INPUT_PATH = params.maia.inputPath
  out.MAIA_OUTPUT_PATH = params.maia.outputPath
  out.MAIA_RUN_DIR = params.maia.runDir
  out.MAIA_ATTEMPT_DIR = params.maia.attemptDir
  out.MAIA_WORKFLOW_ID = params.maia.workflowId
  out.MAIA_WORKFLOW_DEPS_HASH = params.maia.depsHash

  // Optional base vars.
  const tz = String(process.env.TZ ?? "").trim()
  if (tz) out.TZ = tz
  const lang = String(process.env.LANG ?? "").trim()
  if (lang) out.LANG = lang
  const lcAll = String(process.env.LC_ALL ?? "").trim()
  if (lcAll) out.LC_ALL = lcAll

  return out
}

export async function runnerExecStepNdjson(params: {
  runnerUrl: string
  token: string
  body: RunnerStepExecRequest
  abort: AbortSignal
  onLog: (ev: RunnerLogEvent) => void | Promise<void>
}): Promise<{ exit: RunnerExitEvent; execId: string }> {
  const url = new URL("/v1/exec/step", params.runnerUrl).toString()
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify(params.body),
    signal: params.abort,
  })

  const execId = String(res.headers.get("x-maia-exec-id") ?? "").trim()
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Runner step exec failed: HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`)
  }
  if (!execId) {
    throw new Error(`Runner step exec missing response header: x-maia-exec-id`)
  }
  if (!res.body) {
    throw new Error(`Runner step exec missing response body`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let carry = ""
  let exit: RunnerExitEvent | null = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    carry += decoder.decode(value, { stream: true })
    const parts = carry.split("\n")
    carry = parts.pop() ?? ""
    for (const raw of parts) {
      const line = raw.trimEnd()
      if (!line) continue
      let ev: RunnerEvent | null = null
      try {
        ev = JSON.parse(line) as RunnerEvent
      } catch {
        continue
      }
      if (!ev || typeof ev !== "object") continue
      if (ev.type === "log") {
        const stream = ev.stream === "stderr" ? "stderr" : "stdout"
        const msg = typeof ev.line === "string" ? ev.line : String(ev.line ?? "")
        await params.onLog({ type: "log", stream, line: msg })
      } else if (ev.type === "exit") {
        exit =
          parseExitEvent(ev) ?? ({ type: "exit", exitCode: null, signal: null, error: null } satisfies RunnerExitEvent)
      }
    }
  }

  // Flush last partial line (if any).
  const tail = carry.trimEnd()
  if (tail) {
    try {
      const ev = JSON.parse(tail) as RunnerEvent
      if (ev && typeof ev === "object" && ev.type === "exit") {
        exit =
          parseExitEvent(ev) ?? ({ type: "exit", exitCode: null, signal: null, error: null } satisfies RunnerExitEvent)
      }
    } catch {
      // ignore
    }
  }

  if (!exit) throw new Error(`Runner step exec ended without exit event`)
  return { exit, execId }
}

export async function runnerExecDepsNdjson(params: {
  runnerUrl: string
  token: string
  body: RunnerDepsExecRequest
  abort: AbortSignal
  onLog: (ev: RunnerLogEvent) => void | Promise<void>
}): Promise<{ exit: RunnerExitEvent; execId: string }> {
  const url = new URL("/v1/exec/deps", params.runnerUrl).toString()
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify(params.body),
    signal: params.abort,
  })

  const execId = String(res.headers.get("x-maia-exec-id") ?? "").trim()
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Runner deps exec failed: HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`)
  }
  if (!execId) {
    throw new Error(`Runner deps exec missing response header: x-maia-exec-id`)
  }
  if (!res.body) {
    throw new Error(`Runner deps exec missing response body`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let carry = ""
  let exit: RunnerExitEvent | null = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    carry += decoder.decode(value, { stream: true })
    const parts = carry.split("\n")
    carry = parts.pop() ?? ""
    for (const raw of parts) {
      const line = raw.trimEnd()
      if (!line) continue
      let ev: RunnerEvent | null = null
      try {
        ev = JSON.parse(line) as RunnerEvent
      } catch {
        continue
      }
      if (!ev || typeof ev !== "object") continue
      if (ev.type === "log") {
        const stream = ev.stream === "stderr" ? "stderr" : "stdout"
        const msg = typeof ev.line === "string" ? ev.line : String(ev.line ?? "")
        await params.onLog({ type: "log", stream, line: msg })
      } else if (ev.type === "exit") {
        exit =
          parseExitEvent(ev) ?? ({ type: "exit", exitCode: null, signal: null, error: null } satisfies RunnerExitEvent)
      }
    }
  }

  const tail = carry.trimEnd()
  if (tail) {
    try {
      const ev = JSON.parse(tail) as RunnerEvent
      if (ev && typeof ev === "object" && ev.type === "exit") {
        exit =
          parseExitEvent(ev) ?? ({ type: "exit", exitCode: null, signal: null, error: null } satisfies RunnerExitEvent)
      }
    } catch {
      // ignore
    }
  }

  if (!exit) throw new Error(`Runner deps exec ended without exit event`)
  return { exit, execId }
}

export async function runnerCancelExec(params: {
  runnerUrl: string
  token: string
  execId: string
  mode: "stop" | "kill"
}) {
  const url = new URL(`/v1/exec/${encodeURIComponent(params.execId)}/cancel`, params.runnerUrl).toString()
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: params.mode }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Runner cancel failed: HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`)
  }
}

import "server-only"

import { LogSource, LogLevel, WorkflowDepsStatus } from "@prisma/client"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { ensureDir, pathExists, sha256, writeJsonAtomic } from "@/lib/server/maia/fs"
import { workflowDepsDir, workflowDir } from "@/lib/server/maia/paths"
import {
  getRunnerConfigFromEnv,
  type RunnerMountMode,
  runnerCancelExec,
  runnerExecDepsNdjson,
} from "@/lib/server/maia/runner-client"
import { emitWorkflowDepsLog, emitWorkflowDepsStatus } from "@/lib/server/maia/realtime"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

type ErrorWithDepsMeta = Error & { __maiaDepsMeta?: Record<string, unknown> }

const depsSchema = z.record(z.string().min(1), z.string().min(1))

export type DependenciesJson = Record<string, string>

export function parseDependenciesJson(raw: string): DependenciesJson {
  if (!raw || raw.trim() === "") return {}
  const parsed = JSON.parse(raw) as unknown
  return depsSchema.parse(parsed)
}

export function stableDepsString(deps: DependenciesJson) {
  const entries = Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(Object.fromEntries(entries))
}

export function depsHash(deps: DependenciesJson) {
  return sha256(stableDepsString(deps))
}

async function appendInstallLog(
  workflowId: string,
  workflowPublicId: string,
  message: string,
  level: LogLevel = LogLevel.INFO,
) {
  await prisma.logEvent.create({
    data: {
      runId: null,
      stepKey: null,
      attemptNo: null,
      level,
      source: LogSource.INSTALL,
      message: `[workflow:${workflowId}] ${message}`,
    },
  })
  // Stream topic uses workflow publicId (UI routes are publicId-based).
  await emitWorkflowDepsLog({ workflowId: workflowPublicId, level: String(level), message }).catch(() => {})
}

function splitLogLines(buf: Buffer) {
  const s = buf.toString("utf8")
  // Normalize newlines and split; preserve indentation; drop trailing empty line segments.
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((x) => x.replace(/\r$/, ""))
}

export async function ensureWorkflowDepsInstalled(
  workflowId: string,
  opts?: {
    signal?: AbortSignal
    log?: (line: string, level?: LogLevel) => void | Promise<void>
    // If provided, install deps for this specific snapshot (do NOT update Workflow.depsStatus unless it matches current workflow depsHash).
    dependencies?: string
    depsHash?: string
  },
) {
  const wf = await prisma.workflow.findUnique({ where: { id: workflowId } })
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`)
  const workflowPublicId = typeof wf.publicId === "string" ? wf.publicId : workflowId

  await ensureDir(workflowDir(workflowId))

  const depsRaw = typeof opts?.dependencies === "string" ? opts.dependencies : wf.dependencies
  const deps = parseDependenciesJson(depsRaw)
  const requestedHash =
    typeof opts?.depsHash === "string" && opts.depsHash.trim().length ? opts.depsHash : depsHash(deps)
  const isCurrentWorkflowDeps = requestedHash === wf.depsHash && depsRaw === wf.dependencies

  const dir = workflowDepsDir(workflowId, requestedHash)
  await ensureDir(dir)

  const depsCount = Object.keys(deps).length
  if (depsCount === 0) {
    if (
      isCurrentWorkflowDeps &&
      (wf.depsStatus !== WorkflowDepsStatus.READY || wf.depsErrorCode || wf.depsErrorMessage || wf.depsErrorMetaJson)
    ) {
      await prisma.workflow.update({
        where: { id: workflowId },
        data: {
          depsStatus: WorkflowDepsStatus.READY,
          depsErrorCode: null,
          depsErrorMessage: null,
          depsErrorMetaJson: null,
          depsErrorAt: null,
          depsUpdatedAt: new Date(),
        },
      })
      await emitWorkflowDepsStatus({
        workflowId: workflowPublicId,
        depsStatus: WorkflowDepsStatus.READY,
        depsErrorCode: null,
        depsErrorMessage: null,
      }).catch(() => {})
    }
    return
  }

  if (opts?.signal?.aborted) throw new Error("Cancel requested")

  const nodeModules = path.join(dir, "node_modules")
  const alreadyReady = await pathExists(nodeModules)
  if (alreadyReady) {
    // Reconcile persisted status with on-disk reality. This fixes cases where:
    // - deps were installed previously
    // - later workflow edits reset depsStatus to IDLE
    // - users click "Install" again and we short-circuit before updating status
    if (
      isCurrentWorkflowDeps &&
      (wf.depsStatus !== WorkflowDepsStatus.READY || wf.depsErrorCode || wf.depsErrorMessage || wf.depsErrorMetaJson)
    ) {
      await prisma.workflow.update({
        where: { id: workflowId },
        data: {
          depsStatus: WorkflowDepsStatus.READY,
          depsErrorCode: null,
          depsErrorMessage: null,
          depsErrorMetaJson: null,
          depsErrorAt: null,
          depsUpdatedAt: new Date(),
        },
      })
      await emitWorkflowDepsStatus({
        workflowId: workflowPublicId,
        depsStatus: WorkflowDepsStatus.READY,
        depsErrorCode: null,
        depsErrorMessage: null,
      }).catch(() => {})
    }
    return
  }

  // Lock-ish only for the current workflow deps (legacy status fields are per-workflow, not per-depsHash).
  if (isCurrentWorkflowDeps) {
    const updated = await prisma.workflow.updateMany({
      where: {
        id: workflowId,
        NOT: { depsStatus: WorkflowDepsStatus.INSTALLING },
      },
      data: {
        depsStatus: WorkflowDepsStatus.INSTALLING,
        depsErrorCode: null,
        depsErrorMessage: null,
        depsErrorMetaJson: null,
        depsErrorAt: null,
        depsUpdatedAt: new Date(),
      },
    })
    if (updated.count > 0) {
      await emitWorkflowDepsStatus({
        workflowId: workflowPublicId,
        depsStatus: WorkflowDepsStatus.INSTALLING,
        depsErrorCode: null,
        depsErrorMessage: null,
      }).catch(() => {})
    }

    if (updated.count === 0) {
      // Someone else is installing. Poll for ready/failed.
      for (let i = 0; i < 60; i++) {
        const cur = await prisma.workflow.findUnique({ where: { id: workflowId } })
        if (!cur) throw new Error(`Workflow not found: ${workflowId}`)
        if (cur.depsStatus === WorkflowDepsStatus.READY) return
        if (cur.depsStatus === WorkflowDepsStatus.FAILED)
          throw new Error(cur.depsErrorMessage ?? "Dependency install failed")
        await new Promise((r) => setTimeout(r, 500))
      }
      throw new Error("Timed out waiting for dependency installation lock")
    }
  }

  try {
    const pkgJson = {
      name: `maia-workflow-${workflowId}-${requestedHash}`,
      private: true,
      type: "commonjs",
      dependencies: deps,
    }
    await writeJsonAtomic(path.join(dir, "package.json"), pkgJson)

    // Only prefix deps hash for lifecycle lines; keep pnpm output clean for readability.
    await appendInstallLog(workflowId, workflowPublicId, `deps(${requestedHash}) pnpm install (prod) starting…`)
    await opts?.log?.(`deps(${requestedHash}) pnpm install (prod) starting…`)

    const runnerCfg = getRunnerConfigFromEnv()
    if (runnerCfg.ok) {
      const mountMode: RunnerMountMode =
        String(process.env.MAIA_RUNNER_MOUNT_MODE ?? "").trim() === "strict" ? "strict" : "default"

      const startedAt = Date.now()
      const abort = new AbortController()
      let execId = ""
      const onAbort = () => {
        try {
          abort.abort(new Error("Cancel requested"))
        } catch {}
        if (execId)
          void runnerCancelExec({ runnerUrl: runnerCfg.url, token: runnerCfg.token, execId, mode: "kill" }).catch(
            () => {},
          )
      }
      if (opts?.signal) {
        if (opts.signal.aborted) onAbort()
        else opts.signal.addEventListener("abort", onAbort, { once: true })
      }

      const depsEnv: Record<string, string> = {
        NODE_ENV:
          process.env.NODE_ENV === "development" ||
          process.env.NODE_ENV === "test" ||
          process.env.NODE_ENV === "production"
            ? process.env.NODE_ENV
            : "production",
      }
      const tz = String(process.env.TZ ?? "").trim()
      if (tz) depsEnv.TZ = tz
      const lang = String(process.env.LANG ?? "").trim()
      if (lang) depsEnv.LANG = lang
      const lcAll = String(process.env.LC_ALL ?? "").trim()
      if (lcAll) depsEnv.LC_ALL = lcAll

      const r = await runnerExecDepsNdjson({
        runnerUrl: runnerCfg.url,
        token: runnerCfg.token,
        abort: abort.signal,
        body: {
          workflowId,
          depsHash: requestedHash,
          depsDirAbs: dir,
          mountMode,
          env: depsEnv,
          limits: { timeoutMs: 10 * 60 * 1000 },
        },
        onLog: async (ev) => {
          const level = ev.stream === "stderr" ? LogLevel.WARN : LogLevel.INFO
          await appendInstallLog(workflowId, workflowPublicId, ev.line, level).catch(() => {})
          await Promise.resolve(opts?.log?.(ev.line, level)).catch(() => {})
        },
      })
      execId = r.execId
      if (opts?.signal) opts.signal.removeEventListener("abort", onAbort as EventListener)

      const durationMs = Date.now() - startedAt
      await appendInstallLog(
        workflowId,
        workflowPublicId,
        `audit: execId=${execId} mountMode=${mountMode} durationMs=${durationMs} exitCode=${r.exit.exitCode ?? "null"} signal=${r.exit.signal ?? "null"}`,
        LogLevel.INFO,
      ).catch(() => {})

      if (r.exit.exitCode !== 0) {
        const runnerError = typeof r.exit.error === "string" && r.exit.error.trim().length ? r.exit.error.trim() : null
        // Keep the wrapper message stable, but attach runnerError as the root cause when available.
        const msg =
          `pnpm install failed` + (typeof r.exit.exitCode === "number" ? ` with exit code ${r.exit.exitCode}` : "")
        const e2 = (
          runnerError ? new Error(msg, { cause: new Error(runnerError) }) : new Error(msg)
        ) as ErrorWithDepsMeta
        e2.__maiaDepsMeta = {
          depsHash: requestedHash,
          cwd: dir,
          exitCode: r.exit.exitCode,
          signal: r.exit.signal,
          runnerError,
        }
        throw e2
      }
    } else {
      const pnpmArgs = ["install", "--prod", "--ignore-scripts", "--no-frozen-lockfile"]
      await new Promise<void>((resolve, reject) => {
        const child = spawn("pnpm", pnpmArgs, {
          cwd: dir,
          env: process.env,
        })

        // NOTE: child process stdout/stderr "data" events are chunked (not line-based).
        // A robust root-fix is to buffer until newline boundaries so the UI doesn't see half-lines
        // or multi-line blobs depending on chunking.
        const outCarry = { s: "" }
        const errCarry = { s: "" }

        const onAbort = () => {
          try {
            child.kill("SIGTERM")
          } catch {}
        }
        if (opts?.signal) {
          if (opts.signal.aborted) onAbort()
          else opts.signal.addEventListener("abort", onAbort, { once: true })
        }

        child.stdout.on("data", (buf) => {
          // Combine with carry and split by newline; keep last partial line in carry.
          const chunk = outCarry.s + buf.toString("utf8").replace(/\r\n/g, "\n")
          const parts = chunk.split("\n")
          outCarry.s = parts.pop() ?? ""
          const lines = parts.map((x) => x.replace(/\r$/, ""))
          for (const raw of lines) {
            const line = raw.trimEnd()
            if (!line) continue
            appendInstallLog(workflowId, workflowPublicId, line).catch(() => {})
            Promise.resolve(opts?.log?.(line)).catch(() => {})
          }
        })
        child.stderr.on("data", (buf) => {
          const chunk = errCarry.s + buf.toString("utf8").replace(/\r\n/g, "\n")
          const parts = chunk.split("\n")
          errCarry.s = parts.pop() ?? ""
          const lines = parts.map((x) => x.replace(/\r$/, ""))
          for (const raw of lines) {
            const line = raw.trimEnd()
            if (!line) continue
            appendInstallLog(workflowId, workflowPublicId, line, LogLevel.WARN).catch(() => {})
            Promise.resolve(opts?.log?.(line, LogLevel.WARN)).catch(() => {})
          }
        })

        child.on("error", (err) => {
          const e2 = new Error(
            `pnpm spawn failed: ${err instanceof Error ? err.message : String(err)}`,
          ) as ErrorWithDepsMeta
          const spawnErrorCode =
            typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : null
          e2.__maiaDepsMeta = {
            depsHash: requestedHash,
            cwd: dir,
            command: "pnpm",
            args: pnpmArgs,
            spawnErrorCode,
            spawnErrorMessage: err instanceof Error ? err.message : String(err),
          }
          reject(e2)
        })
        child.on("close", (code, signal) => {
          if (opts?.signal) opts.signal.removeEventListener("abort", onAbort as EventListener)
          // Flush any final partial line (if pnpm exits without a trailing newline).
          const tailOut = outCarry.s.replace(/\r$/, "").trimEnd()
          if (tailOut) {
            appendInstallLog(workflowId, workflowPublicId, tailOut).catch(() => {})
            Promise.resolve(opts?.log?.(tailOut)).catch(() => {})
          }
          const tailErr = errCarry.s.replace(/\r$/, "").trimEnd()
          if (tailErr) {
            appendInstallLog(workflowId, workflowPublicId, tailErr, LogLevel.WARN).catch(() => {})
            Promise.resolve(opts?.log?.(tailErr, LogLevel.WARN)).catch(() => {})
          }
          if (code === 0) resolve()
          else {
            const e2 = new Error(
              `pnpm install failed` +
                (typeof code === "number" ? ` with exit code ${code}` : "") +
                (signal ? ` (signal ${signal})` : ""),
            ) as ErrorWithDepsMeta
            e2.__maiaDepsMeta = {
              depsHash: requestedHash,
              cwd: dir,
              command: "pnpm",
              args: pnpmArgs,
              exitCode: typeof code === "number" ? code : null,
              signal: signal ? String(signal) : null,
            }
            reject(e2)
          }
        })
      })
    }

    // Write a tiny marker so we can sanity-check.
    await fs.writeFile(path.join(dir, ".maia-installed"), `${requestedHash}\n`, "utf8")

    await appendInstallLog(workflowId, workflowPublicId, `deps(${requestedHash}) pnpm install (prod) finished ✅`)
    await opts?.log?.(`deps(${requestedHash}) pnpm install (prod) finished ✅`)

    if (isCurrentWorkflowDeps) {
      await prisma.workflow.update({
        where: { id: workflowId },
        data: {
          depsStatus: WorkflowDepsStatus.READY,
          depsErrorCode: null,
          depsErrorMessage: null,
          depsErrorMetaJson: null,
          depsErrorAt: null,
          depsUpdatedAt: new Date(),
        },
      })
      await emitWorkflowDepsStatus({
        workflowId: workflowPublicId,
        depsStatus: WorkflowDepsStatus.READY,
        depsErrorCode: null,
        depsErrorMessage: null,
      }).catch(() => {})
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const extraMeta =
      isPlainObject(e) && isPlainObject((e as Record<string, unknown>).__maiaDepsMeta)
        ? ((e as Record<string, unknown>).__maiaDepsMeta as Record<string, unknown>)
        : null
    await appendInstallLog(
      workflowId,
      workflowPublicId,
      `deps(${requestedHash}) pnpm install (prod) failed: ${msg}`,
      LogLevel.ERROR,
    )
    await opts?.log?.(`deps(${requestedHash}) pnpm install (prod) failed: ${msg}`, LogLevel.ERROR)
    if (isCurrentWorkflowDeps) {
      const now = new Date()
      await prisma.workflow.update({
        where: { id: workflowId },
        data: {
          depsStatus: WorkflowDepsStatus.FAILED,
          depsErrorCode: "DEPS_INSTALL_FAILED",
          depsErrorMessage: msg,
          depsErrorMetaJson: JSON.stringify(
            {
              detail: msg,
              depsHash: requestedHash,
              ...(extraMeta ?? undefined),
            },
            null,
            2,
          ),
          depsErrorAt: now,
          depsUpdatedAt: now,
        },
      })
      await emitWorkflowDepsStatus({
        workflowId: workflowPublicId,
        depsStatus: WorkflowDepsStatus.FAILED,
        depsErrorCode: "DEPS_INSTALL_FAILED",
        depsErrorMessage: msg,
      }).catch(() => {})
    }
    throw e
  }
}

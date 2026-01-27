import "server-only"

import { RunStatus } from "@prisma/client"
import crypto from "crypto"

import { ensureSqlitePragmas, prisma } from "@/lib/server/db"
import {
  claimJobRunAndCreateRun as claimJobRunAndCreateRunImpl,
  processCancelRequestedJobRuns as processCancelRequestedJobRunsImpl,
  processQueuedJobRuns as processQueuedJobRunsImpl,
  requestCancelJobRun as requestCancelJobRunImpl,
  recoverExpiredLeases as recoverExpiredLeasesImpl,
  reconcileJobRunsWithTerminalRuns as reconcileJobRunsWithTerminalRunsImpl,
} from "@/lib/server/maia/engine/jobs"
import { rollupBatches as rollupBatchesImpl } from "@/lib/server/maia/engine/batches"
import { processPendingInputs as processPendingInputsImpl } from "@/lib/server/maia/engine/inputs"
import type { DownloadingInput } from "@/lib/server/maia/engine/types"
import {
  ATTEMPT_LEASE_MS,
  GLOBAL_RUN_CONCURRENCY,
  MAX_INTERRUPTED_ATTEMPTS_PER_STEP,
  PER_RUN_STEP_CONCURRENCY,
} from "@/lib/server/maia/config"
import { ensureMaiaInitialized } from "@/lib/server/maia/init"
import { createRunFromJobRun } from "@/lib/server/maia/run-factory"
import { processSchedules } from "@/lib/server/maia/scheduler"
import { emitJobRunState, emitScheduleState } from "@/lib/server/maia/realtime"
import {
  processCancelRequestedRuns as processCancelRequestedRunsImpl,
  reconcileTerminalRuns as reconcileTerminalRunsImpl,
  finishRun as finishRunImpl,
} from "@/lib/server/maia/engine/runs"
import { executeAttempt as executeAttemptImpl } from "@/lib/server/maia/engine/runner"
import { claimAndStartAttempt as claimAndStartAttemptImpl } from "@/lib/server/maia/engine/steps"
import {
  cancelRun as cancelRunImpl,
  forceStopRun as forceStopRunImpl,
  requestCancelRun as requestCancelRunImpl,
  rerunStep as rerunStepImpl,
  restartFromStep as restartFromStepImpl,
  retryStep as retryStepImpl,
} from "@/lib/server/maia/engine/commands"
import { scheduleRun as scheduleRunImpl, scheduleRuns as scheduleRunsImpl } from "@/lib/server/maia/engine/scheduling"
import { reconcileAttempts as reconcileAttemptsImpl } from "./engine/reconcile-attempts"

import type { RunningProc } from "@/lib/server/maia/engine/types"

export class MaiaEngine {
  private running = new Map<string, RunningProc>() // key: `${runId}:${stepKey}`
  private ticking = false
  private pendingHighTick = false
  private pendingLowTick = false
  private tickSeq = 0
  private timer: NodeJS.Timeout | null = null
  private inputDownloads = new Map<string, DownloadingInput>() // key: `${runId}:${fileId}`

  start() {
    if (this.timer) return
    const tickMs = Number(process.env.MAIA_ENGINE_TICK_MS ?? 500)
    this.timer = setInterval(
      () => {
        this.tick({ priority: "low", reason: "interval" }).catch(() => {})
      },
      Number.isFinite(tickMs) && tickMs > 0 ? tickMs : 500,
    )
  }

  stop() {
    // Stop the engine loop first.
    if (this.timer) clearInterval(this.timer)
    this.timer = null

    // Important in dev (HMR): old engine instances can be replaced without the Node process
    // exiting. If we don't clean up, child processes may continue running and keep streaming logs.
    //
    // This is also a reasonable "graceful shutdown" behavior in prod.
    for (const [k, proc] of this.running.entries()) {
      try {
        if (proc.timeout) clearTimeout(proc.timeout)
      } catch {}
      try {
        if (proc.heartbeat) clearInterval(proc.heartbeat)
      } catch {}
      try {
        if (proc.kind === "child_process") {
          // Stop log streaming callbacks ASAP.
          proc.child.stdout?.removeAllListeners("data")
          proc.child.stderr?.removeAllListeners("data")
          proc.child.removeAllListeners("close")
        } else if (proc.kind === "runner") {
          proc.abort.abort(new Error("engine stopped"))
        }
      } catch {}
      try {
        if (proc.kind === "child_process") {
          proc.child.kill("SIGKILL")
        } else if (proc.kind === "runner") {
          void proc.cancel("kill").catch(() => {})
        }
      } catch {}
      this.running.delete(k)
    }

    for (const [k, d] of this.inputDownloads.entries()) {
      try {
        d.abort.abort(new Error("engine stopped"))
      } catch {}
      this.inputDownloads.delete(k)
    }
  }

  async tick(opts?: { priority?: "low" | "high"; reason?: string }) {
    const priority = opts?.priority ?? "high"
    if (this.ticking) {
      if (priority === "high") this.pendingHighTick = true
      else this.pendingLowTick = true
      return
    }

    this.ticking = true
    const seq = (this.tickSeq = (this.tickSeq + 1) % 1_000_000)
    const now = new Date()
    try {
      await ensureSqlitePragmas()
      await ensureMaiaInitialized()

      // De-phase heavier tasks to reduce SQLite contention.
      const doSchedules = seq % 2 === 0 // ~1s if tick is 500ms
      const doLeaseRecovery = seq % 10 === 0 // ~5s
      const doJobRunReconcile = seq % 2 === 1 // ~1s (offset from schedules)
      const doBatchRollup = seq % 4 === 0 // ~2s
      const doAttemptReconcile = seq % 2 === 0 // ~1s

      if (doSchedules) {
        const res = await prisma.$transaction(async (tx) => {
          return await processSchedules(tx, now)
        })
        for (const jobRunId of res.createdJobRunIds) {
          await emitJobRunState(jobRunId).catch(() => {})
        }
        for (const scheduleId of res.touchedScheduleIds) {
          await emitScheduleState(scheduleId).catch(() => {})
        }
      }

      if (doLeaseRecovery) await this.recoverExpiredLeases()

      await this.processCancelRequestedJobRuns()
      await this.processQueuedJobRuns()
      await this.processCancelRequestedRuns()
      await this.processPendingInputs()
      if (doAttemptReconcile) await this.reconcileAttempts()
      await this.reconcileTerminalRuns()
      if (doJobRunReconcile) await this.reconcileJobRunsWithTerminalRuns()
      await this.scheduleRuns()
      if (doBatchRollup) await this.rollupBatches()
    } finally {
      this.ticking = false

      const shouldDrainHigh = this.pendingHighTick
      if (shouldDrainHigh) {
        this.pendingHighTick = false
        this.pendingLowTick = false
      } else {
        // Low-priority ticks can be dropped; the interval will fire again soon.
        this.pendingLowTick = false
      }

      if (shouldDrainHigh) void this.tick({ priority: "low", reason: "drain-high" })
    }
  }

  async requestCancelJobRun(params: { jobRunId: string; reason?: string | null }) {
    return await requestCancelJobRunImpl({
      jobRunId: params.jobRunId,
      reason: params.reason ?? null,
      requestCancelRun: (args) => this.requestCancelRun(args),
    })
  }

  private async processCancelRequestedJobRuns() {
    await processCancelRequestedJobRunsImpl({
      requestCancelRun: async (args) => {
        await this.requestCancelRun(args).catch(() => {})
      },
    })
  }

  private async processCancelRequestedRuns() {
    await processCancelRequestedRunsImpl({
      finishRun: async (runId, status) => {
        await this.finishRun(runId, status)
      },
    })
  }

  private async recoverExpiredLeases() {
    await recoverExpiredLeasesImpl()
  }

  private async reconcileJobRunsWithTerminalRuns() {
    await reconcileJobRunsWithTerminalRunsImpl()
  }

  private async rollupBatches() {
    await rollupBatchesImpl()
  }

  private async processQueuedJobRuns() {
    await processQueuedJobRunsImpl({
      globalRunConcurrency: GLOBAL_RUN_CONCURRENCY,
      claimJobRunAndCreateRun: async (jobRunId) => {
        await this.claimJobRunAndCreateRun(String(jobRunId))
      },
    })
  }

  private async claimJobRunAndCreateRun(jobRunId: string) {
    const engineId = getEngineInstanceId()
    await claimJobRunAndCreateRunImpl({ jobRunId, engineId, createRunFromJobRun })
  }

  private async reconcileTerminalRuns() {
    await reconcileTerminalRunsImpl({
      finishRun: async (runId, status) => {
        await this.finishRun(runId, status)
      },
    })
  }

  private async processPendingInputs() {
    await processPendingInputsImpl({
      inputDownloads: this.inputDownloads,
      finishRun: async (runId, status) => {
        await this.finishRun(runId, status)
      },
    })
  }

  private async scheduleRuns() {
    await scheduleRunsImpl({
      scheduleRun: async (runId) => {
        await this.scheduleRun(runId)
      },
    })
  }

  private async scheduleRun(runId: string) {
    await scheduleRunImpl({
      runId,
      perRunStepConcurrency: PER_RUN_STEP_CONCURRENCY,
      claimAndStartAttempt: (runId, stepKey) => this.claimAndStartAttempt(runId, stepKey),
      finishRun: (runId, status) => this.finishRun(runId, status),
    })
  }

  private async reconcileAttempts() {
    await reconcileAttemptsImpl({
      maxInterruptedAttemptsPerStep: MAX_INTERRUPTED_ATTEMPTS_PER_STEP,
      finishRun: async (runId, status) => {
        await this.finishRun(runId, status)
      },
    })
  }

  private async finishRun(runId: string, status: RunStatus) {
    await finishRunImpl({ runId, status, running: this.running, inputDownloads: this.inputDownloads })
  }

  private async claimAndStartAttempt(runId: string, stepKey: string) {
    const workerId = getEngineInstanceId()
    return await claimAndStartAttemptImpl({
      runId,
      stepKey,
      workerId,
      attemptLeaseMs: ATTEMPT_LEASE_MS,
      executeAttempt: ({ runId, stepKey, attemptNo }) => {
        void this.executeAttempt(workerId, runId, stepKey, attemptNo)
      },
    })
  }

  private async executeAttempt(workerId: string, runId: string, stepKey: string, attemptNo: number) {
    await executeAttemptImpl({
      runId,
      stepKey,
      attemptNo,
      workerId,
      running: this.running,
      finishRun: async (runId, status) => {
        await this.finishRun(runId, status)
      },
    })
  }

  async cancelRun(runId: string) {
    await cancelRunImpl({ runId, finishRun: (id, st) => this.finishRun(id, st) })
  }

  async requestCancelRun(params: { runId: string; reason?: string | null }) {
    return await requestCancelRunImpl({
      runId: params.runId,
      reason: params.reason ?? null,
      finishRun: (id, st) => this.finishRun(id, st),
    })
  }

  async forceStopRun(runId: string) {
    await forceStopRunImpl({ runId, finishRun: (id, st) => this.finishRun(id, st) })
  }

  async retryStep(runId: string, stepKey: string) {
    await retryStepImpl({ runId, stepKey })
  }

  async rerunStep(runId: string, stepKey: string): Promise<{ ok: true; newRunId: string }> {
    return await rerunStepImpl({ runId, stepKey })
  }

  async restartFromStep(runId: string, startStepKey: string): Promise<{ ok: true; newRunId: string }> {
    return await restartFromStepImpl({ runId, startStepKey })
  }
}

declare global {
  var __maiaEngine: MaiaEngine | undefined
  var __maiaEngineToken: symbol | undefined
  var __maiaEngineInstanceId: string | undefined
}

// Dev HMR note:
// Next.js can reload modules without restarting the Node process.
// Because we store the engine instance on globalThis, an old instance can persist across reloads
// and keep executing stale logic. Use a per-module token to recreate the engine in dev when code reloads.
const ENGINE_MODULE_TOKEN = Symbol("maia.engine.module")

function getEngineInstanceId() {
  if (typeof globalThis.__maiaEngineInstanceId === "string" && globalThis.__maiaEngineInstanceId.trim()) {
    return globalThis.__maiaEngineInstanceId
  }

  // Prefer stable, operator-friendly identifiers in prod (K8s/containers).
  const fromEnv =
    process.env.MAIA_ENGINE_ID ||
    process.env.POD_NAME ||
    process.env.HOSTNAME ||
    process.env.DYNO ||
    process.env.INSTANCE_ID ||
    ""
  const normalized = String(fromEnv || "").trim()

  // Fallback: stable per-process id.
  const fallback = `engine:${process.pid}:${crypto.randomUUID().slice(0, 8)}`
  globalThis.__maiaEngineInstanceId = normalized || fallback
  return globalThis.__maiaEngineInstanceId
}

export function getEngine() {
  const existing = globalThis.__maiaEngine
  if (existing && globalThis.__maiaEngineToken === ENGINE_MODULE_TOKEN) return existing
  if (existing) {
    try {
      existing.stop()
    } catch {}
  }
  const eng = new MaiaEngine()
  eng.start()
  globalThis.__maiaEngine = eng
  globalThis.__maiaEngineToken = ENGINE_MODULE_TOKEN
  // Ensure instance id exists (used for claimedBy).
  void getEngineInstanceId()
  return eng
}

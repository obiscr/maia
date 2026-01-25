import "server-only"

import os from "node:os"
import { readRuntimeSettingsSync } from "@/lib/server/maia/runtime-settings"
import type { RuntimeSettings } from "@/lib/server/maia/runtime-settings"

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function readIntEnv(name: string, fallback: number, opts?: { min?: number; max?: number }) {
  const raw = Number(process.env[name] ?? fallback)
  const n = Number.isFinite(raw) ? raw : fallback
  const min = typeof opts?.min === "number" ? opts.min : Number.NEGATIVE_INFINITY
  const max = typeof opts?.max === "number" ? opts.max : Number.POSITIVE_INFINITY
  return clampInt(n, min, max)
}

const RUNTIME_SETTINGS = readRuntimeSettingsSync()

type OsWithAvailableParallelism = typeof os & { availableParallelism?: () => number }

function getAvailableParallelism() {
  const maybe = (os as unknown as OsWithAvailableParallelism).availableParallelism
  return typeof maybe === "function" ? Number(maybe()) : os.cpus().length
}

function readIntSetting(params: {
  envName: string
  overrideKey: keyof RuntimeSettings
  fallback: number
  min: number
  max: number
}) {
  const rawOverride = RUNTIME_SETTINGS[params.overrideKey]
  if (typeof rawOverride === "number" && Number.isFinite(rawOverride)) {
    return clampInt(rawOverride, params.min, params.max)
  }
  return readIntEnv(params.envName, params.fallback, { min: params.min, max: params.max })
}

function defaultGlobalRunConcurrency() {
  // Conservative default: avoid spawning too many concurrent runs (and containers).
  // Operator can override via GLOBAL_RUN_CONCURRENCY.
  const avail = getAvailableParallelism()
  const safe = Math.max(1, Math.floor((Number.isFinite(avail) ? avail : 2) / 2))
  return Math.min(4, safe) // cap default to reduce risk of host overload
}

export const GLOBAL_RUN_CONCURRENCY = readIntSetting({
  envName: "GLOBAL_RUN_CONCURRENCY",
  overrideKey: "globalRunConcurrency",
  fallback: defaultGlobalRunConcurrency(),
  min: 1,
  max: 10_000,
})
export const PER_RUN_STEP_CONCURRENCY = readIntSetting({
  envName: "PER_RUN_STEP_CONCURRENCY",
  overrideKey: "perRunStepConcurrency",
  fallback: 2,
  min: 1,
  max: 10_000,
})

// Hard safety defaults
export const DEFAULT_STEP_TIMEOUT_MS = readIntSetting({
  envName: "DEFAULT_STEP_TIMEOUT_MS",
  overrideKey: "defaultStepTimeoutMs",
  fallback: 10 * 60 * 1000,
  min: 1_000,
  max: 24 * 60 * 60 * 1000,
})

// Run-level input downloads (URL -> runDir/uploads/...)
export const INPUT_DOWNLOAD_CONCURRENCY = readIntSetting({
  envName: "INPUT_DOWNLOAD_CONCURRENCY",
  overrideKey: "inputDownloadConcurrency",
  fallback: 2,
  min: 1,
  max: 10_000,
})
export const INPUT_DOWNLOAD_TIMEOUT_MS = readIntSetting({
  envName: "INPUT_DOWNLOAD_TIMEOUT_MS",
  overrideKey: "inputDownloadTimeoutMs",
  fallback: 60_000,
  min: 1_000,
  max: 60 * 60 * 1000,
})
export const INPUT_DOWNLOAD_MAX_BYTES = readIntSetting({
  envName: "INPUT_DOWNLOAD_MAX_BYTES",
  overrideKey: "inputDownloadMaxBytes",
  fallback: 50 * 1024 * 1024,
  min: 1,
  max: 10 * 1024 * 1024 * 1024,
})

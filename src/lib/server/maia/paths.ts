import "server-only"

import path from "path"

import { resolveDataDirSync } from "@/lib/server/maia/instance-config"

export function projectRoot() {
  return process.cwd()
}

export function maiaDataDir() {
  return resolveDataDirSync()
}

export function runsRootDir() {
  return path.join(maiaDataDir(), "runs")
}

export function runDir(runId: string) {
  return path.join(runsRootDir(), runId)
}

export function jobRunsRootDir() {
  return path.join(maiaDataDir(), "job-runs")
}

export function jobRunDir(jobRunId: string) {
  return path.join(jobRunsRootDir(), jobRunId)
}

export function runStepsDir(runId: string) {
  return path.join(runDir(runId), "steps")
}

export function stepDir(runId: string, stepKey: string) {
  return path.join(runStepsDir(runId), stepKey)
}

export function attemptDir(runId: string, stepKey: string, attemptNo: number) {
  return path.join(stepDir(runId, stepKey), "attempts", String(attemptNo))
}

export function workflowRootDir() {
  return path.join(maiaDataDir(), "workflows")
}

export function workflowDir(workflowId: string) {
  return path.join(workflowRootDir(), workflowId)
}

export function blobsRootDir() {
  return path.join(maiaDataDir(), "blobs")
}

/**
 * Content-addressed blob path (SHA-256 hex).
 * Layout: blobs/aa/bb/<sha256>
 */
export function blobRelPath(sha256: string) {
  const s = String(sha256 || "").trim().toLowerCase()
  const a = s.slice(0, 2) || "00"
  const b = s.slice(2, 4) || "00"
  return path.join("blobs", a, b, s || "unknown")
}

export function blobAbsPath(sha256: string) {
  return path.join(maiaDataDir(), blobRelPath(sha256))
}

// Versioned dependency roots (by depsHash) to avoid "latest deps wins" drift across runs.
export function workflowDepsRootDir(workflowId: string) {
  return path.join(workflowDir(workflowId), "deps")
}

export function workflowDepsDir(workflowId: string, depsHash: string) {
  return path.join(workflowDepsRootDir(workflowId), depsHash)
}

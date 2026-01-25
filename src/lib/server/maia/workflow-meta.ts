import "server-only"

import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { workflowSnapshotSchema, type WorkflowSnapshot } from "@/lib/server/maia/snapshot"
import { listReservedInitialInputKeys } from "@/lib/shared/maia/input-spec"

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function normalizeSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  const reserved = Array.isArray(snapshot.reservedInitialInputKeys) ? snapshot.reservedInitialInputKeys : []
  const reservedSorted = [...new Set(reserved.map((x) => String(x).trim()).filter(Boolean))].sort()

  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : []
  const normalizedSteps = steps
    .map((s) => {
      const deps = Array.isArray(s.deps) ? s.deps : []
      const depsSorted = [...new Set(deps.map((x) => String(x).trim()).filter(Boolean))].sort()
      return {
        stepKey: String(s.stepKey ?? "").trim(),
        name: String(s.name ?? "").trim() || String(s.stepKey ?? "").trim(),
        scriptEsm: typeof s.scriptEsm === "string" ? s.scriptEsm : String(s.scriptEsm ?? ""),
        timeoutMs: Number.isFinite(s.timeoutMs) ? Math.trunc(Number(s.timeoutMs)) : 10 * 60 * 1000,
        deps: depsSorted,
      }
    })
    .filter((s) => s.stepKey.length > 0)
    .sort((a, b) => a.stepKey.localeCompare(b.stepKey))

  return {
    ...snapshot,
    reservedInitialInputKeys: reservedSorted,
    steps: normalizedSteps,
  }
}

async function buildCurrentWorkflowSnapshot(workflowId: string): Promise<WorkflowSnapshot> {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    select: {
      id: true,
      name: true,
      dependencies: true,
      envJson: true,
      inputSpec: true,
      outputsSpec: true,
      depsHash: true,
    },
  })
  if (!workflow) throw new Error("Workflow not found")

  const steps = await prisma.workflowStep.findMany({
    where: { workflowId },
    orderBy: [{ key: "asc" }],
    select: { key: true, name: true, scriptEsm: true, timeoutMs: true },
  })
  const deps = await prisma.workflowStepDep.findMany({
    where: { workflowId },
    select: { stepId: true, dependsOnStepId: true },
  })

  const depMap = new Map<string, string[]>()
  for (const d of deps) {
    const k = String(d.stepId ?? "").trim()
    const dep = String(d.dependsOnStepId ?? "").trim()
    if (!k || !dep) continue
    const arr = depMap.get(k) ?? []
    arr.push(dep)
    depMap.set(k, arr)
  }

  const snapshot = workflowSnapshotSchema.parse({
    workflowId: workflow.id,
    workflowName: workflow.name,
    dependencies: workflow.dependencies,
    envJson: typeof workflow.envJson === "string" ? workflow.envJson : "{}",
    inputSpec:
      typeof workflow.inputSpec === "string"
        ? workflow.inputSpec
        : workflow.inputSpec == null
          ? null
          : String(workflow.inputSpec),
    outputsSpec:
      typeof workflow.outputsSpec === "string"
        ? workflow.outputsSpec
        : workflow.outputsSpec == null
          ? null
          : String(workflow.outputsSpec),
    reservedInitialInputKeys: listReservedInitialInputKeys(),
    depsHash: workflow.depsHash,
    steps: steps.map((s) => ({
      stepKey: s.key,
      name: s.name,
      scriptEsm: s.scriptEsm ?? "",
      timeoutMs: s.timeoutMs,
      deps: depMap.get(s.key) ?? [],
    })),
  })
  return normalizeSnapshot(snapshot)
}

function normalizeSnapshotJson(snapshotJson: string): string {
  const parsed = workflowSnapshotSchema.parse(JSON.parse(snapshotJson || "{}"))
  return JSON.stringify(normalizeSnapshot(parsed))
}

export async function getWorkflowDraftMeta(workflowId: string): Promise<{
  latestVersionNumber: number | null
  hasUnpublishedChanges: boolean
}> {
  const latest = await prisma.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: [{ version: "desc" }],
    select: { version: true, snapshotJson: true },
  })

  const currentSnapshotJson = JSON.stringify(await buildCurrentWorkflowSnapshot(workflowId))
  const currentHash = sha256Hex(currentSnapshotJson)

  const latestVersionNumber = typeof latest?.version === "number" ? latest.version : null
  if (!latest || !latest.snapshotJson) {
    return { latestVersionNumber, hasUnpublishedChanges: true }
  }

  const latestNormalized = normalizeSnapshotJson(latest.snapshotJson)
  const latestHash = sha256Hex(latestNormalized)
  return { latestVersionNumber, hasUnpublishedChanges: currentHash !== latestHash }
}

import "server-only"

import crypto from "crypto"

import { prisma } from "@/lib/server/db"
import { workflowSnapshotSchema, type WorkflowSnapshot } from "@/lib/server/maia/snapshot"
import { listReservedInitialInputKeys } from "@/lib/shared/maia/input-spec"

function nextVersionFromExisting(existing: Array<{ version: number }>) {
  const max = existing.reduce((m, r) => Math.max(m, Number(r.version) || 0), 0)
  return max + 1
}

export async function createWorkflowVersionSnapshot(params: {
  workflowId: string
  workflowName: string
  description?: string | null
  createdByUserId?: string | null
  dependencies: string
  envJson: string
  inputSpec: string | null
  outputsSpec: string | null
  depsHash: string
  steps: Array<{
    stepKey: string
    name: string
    scriptEsm: string
    timeoutMs: number
    retryPolicy?: unknown
    deps: string[]
  }>
}) {
  const snapshot: WorkflowSnapshot = workflowSnapshotSchema.parse({
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    dependencies: params.dependencies,
    envJson: params.envJson,
    inputSpec: params.inputSpec,
    outputsSpec: params.outputsSpec,
    reservedInitialInputKeys: listReservedInitialInputKeys(),
    depsHash: params.depsHash,
    steps: params.steps,
  })

  // Auto-increment version number.
  // SQLite doesn't have great concurrent sequence primitives; we do it transactionally by reading existing max.
  // If a rare race happens, the unique(workflowId, version) constraint will reject and the caller can retry.
  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.workflowVersion.findMany({
      where: { workflowId: params.workflowId },
      select: { version: true },
      orderBy: [{ version: "desc" }],
      take: 1,
    })
    const version = nextVersionFromExisting(existing)
    const descTrimmed = typeof params.description === "string" ? params.description.trim() : ""
    const ownerUserId = await tx.workflow
      .findUnique({ where: { id: params.workflowId }, select: { ownerUserId: true } })
      .then((w) => w?.ownerUserId ?? null)
      .catch(() => null)
    const row = await tx.workflowVersion.create({
      data: {
        id: crypto.randomUUID(),
        workflowId: params.workflowId,
        version,
        snapshotJson: JSON.stringify(snapshot),
        description: descTrimmed.length ? descTrimmed : null,
        ownerUserId: ownerUserId ?? params.createdByUserId ?? null,
        createdByUserId: params.createdByUserId ?? null,
        updatedByUserId: params.createdByUserId ?? null,
        triggeredByUserId: params.createdByUserId ?? null,
      },
      select: { id: true, version: true, snapshotJson: true, createdAt: true },
    })
    return row
  })

  return {
    versionId: created.id,
    version: created.version,
    snapshotJson: created.snapshotJson,
    createdAt: created.createdAt,
  }
}

export async function getLatestWorkflowVersion(workflowId: string) {
  return await prisma.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: [{ version: "desc" }],
    select: { id: true, version: true, snapshotJson: true, createdAt: true },
  })
}

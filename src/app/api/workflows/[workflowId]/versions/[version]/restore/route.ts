import "server-only"

import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { parseDependenciesJson } from "@/lib/server/maia/deps"
import { depsHash as hashDeps } from "@/lib/server/maia/deps"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { normalizeRetryPolicyObject } from "@/lib/server/maia/workflow-snapshot-normalize"
import { createWorkflowVersionSnapshot } from "@/lib/server/maia/workflow-versioning"
import {
  validateWorkflowGraph,
  workflowGraphValidationErrorToInvalidSnapshotMeta,
} from "@/lib/shared/maia/workflow-graph-validation"

export const runtime = "nodejs"

export const POST = withApiObservability(
  async (_: Request, ctx: { params: Promise<{ workflowId: string; version: string }> }) => {
    await ensureEngineRunning()
    mark("engine")

    const { workflowId, version } = await ctx.params
    const workflowPublicId = String(workflowId || "")
      .trim()
      .toLowerCase()
    const ver = Number(version)
    if (!Number.isInteger(ver) || ver <= 0) return fail({ status: 400, code: "INVALID_QUERY" })

    const wf = await prisma.workflow.findUnique({ where: { publicId: workflowPublicId } })
    if (!wf) return notFound("WORKFLOW_NOT_FOUND")
    const workflowInternalId = wf.id
    mark("db.workflow")

    const row = await prisma.workflowVersion.findFirst({ where: { workflowId: workflowInternalId, version: ver } })
    if (!row) return notFound("WORKFLOW_VERSION_NOT_FOUND")
    mark("db.version")

    let snap: ReturnType<typeof workflowSnapshotSchema.parse>
    try {
      snap = workflowSnapshotSchema.parse(JSON.parse(row.snapshotJson || "{}"))
    } catch (e) {
      return fail({ status: 500, code: "INVALID_SNAPSHOT" })
    }

    const graphOk = validateWorkflowGraph(snap.steps ?? [])
    if (!graphOk.ok) {
      return fail({
        status: 500,
        code: "INVALID_SNAPSHOT",
        meta: workflowGraphValidationErrorToInvalidSnapshotMeta(graphOk.error),
      })
    }

    // Validate deps JSON string (should already be valid).
    let depsObj: Record<string, string> = {}
    try {
      depsObj = parseDependenciesJson(snap.dependencies || "{}")
    } catch (e) {
      return fail({
        status: 500,
        code: "INVALID_SNAPSHOT",
        meta: { field: "dependencies" },
      })
    }
    const depsHash = hashDeps(depsObj)
    const depsStatus = Object.keys(depsObj).length === 0 ? "READY" : "IDLE"

    await prisma.$transaction(async (tx) => {
      await tx.workflow.update({
        where: { id: workflowInternalId },
        data: {
          // Restore name + environment + contracts + deps.
          name: snap.workflowName ?? wf.name,
          dependencies: snap.dependencies ?? "{}",
          envJson: snap.envJson ?? "{}",
          inputSpec: snap.inputSpec ?? null,
          outputsSpec: snap.outputsSpec ?? null,
          depsHash,
          depsStatus,
          depsErrorCode: null,
          depsErrorMessage: null,
          depsErrorMetaJson: null,
          depsErrorAt: null,
          depsUpdatedAt: new Date(),
        },
      })

      // Replace steps graph to match snapshot.
      await tx.workflowStepDep.deleteMany({ where: { workflowId: workflowInternalId } })
      await tx.workflowStep.deleteMany({ where: { workflowId: workflowInternalId } })

      if (snap.steps?.length) {
        await tx.workflowStep.createMany({
          data: snap.steps.map((s) => ({
            id: crypto.randomUUID(),
            workflowId: workflowInternalId,
            key: s.stepKey,
            name: s.name,
            description: null,
            scriptEsm: s.scriptEsm ?? "",
            timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
            retryPolicyJson: JSON.stringify(normalizeRetryPolicyObject(s.retryPolicy) ?? {}),
          })),
        })

        const edges: { stepId: string; dependsOnStepId: string }[] = []
        for (const s of snap.steps) for (const d of s.deps ?? []) edges.push({ stepId: s.stepKey, dependsOnStepId: d })
        if (edges.length) {
          await tx.workflowStepDep.createMany({
            data: edges.map((e) => ({
              id: crypto.randomUUID(),
              workflowId: workflowInternalId,
              stepId: e.stepId,
              dependsOnStepId: e.dependsOnStepId,
            })),
          })
        }
      }
    })
    mark("db.tx.restore")

    // Record a brand new immutable version after restore (industry-standard: restore == copy to new version).
    const created = await createWorkflowVersionSnapshot({
      workflowId: workflowInternalId,
      workflowName: snap.workflowName ?? wf.name,
      description: `Restored from v${String(row.version)}`,
      dependencies: snap.dependencies ?? "{}",
      envJson: snap.envJson ?? "{}",
      inputSpec: snap.inputSpec ?? null,
      outputsSpec: snap.outputsSpec ?? null,
      depsHash,
      steps: (snap.steps ?? []).map((s) => ({
        stepKey: s.stepKey,
        name: s.name,
        scriptEsm: s.scriptEsm ?? "",
        timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
        retryPolicy: normalizeRetryPolicyObject(s.retryPolicy),
        deps: s.deps ?? [],
      })),
    })
    mark("db.createVersion")

    return ok({
      ok: true,
      // Avoid leaking internal UUIDs (workflowVersion.id).
      restoredFrom: { version: row.version },
      createdVersion: { version: created.version, createdAt: created.createdAt },
    })
  },
)

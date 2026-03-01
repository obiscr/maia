import "server-only"

import crypto from "node:crypto"
import path from "node:path"
import { z } from "zod"
import { AttemptStatus, LogSource } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { listJobs } from "@/lib/server/services/jobs/list-jobs"
import { getJobByPublicId } from "@/lib/server/services/jobs/get-job"
import { deleteJobByPublicId } from "@/lib/server/services/jobs/delete-job"
import { cancelJobByPublicId } from "@/lib/server/services/jobs/cancel-job"
import { resumeJobByPublicId } from "@/lib/server/services/jobs/resume-job"
import { listRuns } from "@/lib/server/services/runs/list-runs"
import { getRunByPublicId } from "@/lib/server/services/runs/get-run"
import { deleteRunByPublicId } from "@/lib/server/services/runs/delete-run"
import { cancelRunByPublicId } from "@/lib/server/services/runs/cancel-run"
import { forceStopRunByPublicId } from "@/lib/server/services/runs/force-stop-run"
import { listWorkflows } from "@/lib/server/services/workflows/list-workflows"
import { getWorkflowByPublicId } from "@/lib/server/services/workflows/get-workflow"
import { patchWorkflowMetaByPublicId } from "@/lib/server/services/workflows/patch-workflow-meta"
import { updateWorkflowByPublicId } from "@/lib/server/services/workflows/update-workflow"
import { deleteWorkflowByPublicId } from "@/lib/server/services/workflows/delete-workflow"
import { listOperations } from "@/lib/server/services/operations/list-operations"
import { getOperationByPublicId } from "@/lib/server/services/operations/get-operation"
import { listSchedules } from "@/lib/server/services/schedules/list-schedules"
import { getScheduleByPublicId } from "@/lib/server/services/schedules/get-schedule"
import { deleteScheduleByPublicId } from "@/lib/server/services/schedules/delete-schedule"
import { previewScheduleByPublicId } from "@/lib/server/services/schedules/preview-schedule"
import { runScheduleNowByPublicId } from "@/lib/server/services/schedules/run-now-schedule"
import { createSchedule } from "@/lib/server/services/schedules/create-schedule"
import { patchScheduleByPublicId } from "@/lib/server/services/schedules/patch-schedule"
import { listBatches } from "@/lib/server/services/batches/list-batches"
import { getBatchByPublicId } from "@/lib/server/services/batches/get-batch"
import { deleteBatchByPublicId } from "@/lib/server/services/batches/delete-batch"
import { pauseBatch, resumeBatch, cancelBatch } from "@/lib/server/services/batches/control-batch"
import { createBatch } from "@/lib/server/services/batches/create-batch"
import { patchBatchByPublicId } from "@/lib/server/services/batches/patch-batch"
import { createBatchJobs } from "@/lib/server/services/batches/create-batch-jobs"
import { startBatchFanout } from "@/lib/server/services/batches/fanout-batch"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { parseDependenciesJson, depsHash } from "@/lib/server/maia/deps"
import {
  parseWorkflowInputSpec,
  parseWorkflowInputSpecWithOpts,
  findReservedKeysInRecord,
} from "@/lib/shared/maia/input-spec"
import { parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"
import { compileJsonSchema, validateWithJsonSchema } from "@/lib/server/maia/jsonschema"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { allocatePublicId } from "@/lib/server/public-ids"
import { makeCreateAudit } from "@/lib/server/audit/write"
import { getWorkflowFindFirstWhereById, getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { getJobRunFindFirstWhereByPublicId } from "@/lib/server/scopes/jobs-scope"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { normalizeRetryPolicyJson, normalizeRetryPolicyObject } from "@/lib/server/maia/workflow-snapshot-normalize"
import { getWorkflowDraftMeta } from "@/lib/server/maia/workflow-meta"
import { ensureWorkflowDepsInstalled } from "@/lib/server/maia/deps"
import { getCleanupConfig, getLastCleanupResult, maybeCleanupOperations } from "@/lib/server/operations/cleanup"
import {
  validateWorkflowGraph,
  workflowGraphValidationErrorToApiError,
  workflowGraphValidationErrorToInvalidSnapshotMeta,
} from "@/lib/shared/maia/workflow-graph-validation"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"
import { ToolExecutionError, type RegisteredTool, type ToolExecutionContext } from "@/lib/server/tools/types"
import { readJsonFileOrNull } from "@/lib/server/maia/fs"
import { attemptDir } from "@/lib/server/maia/paths"

function mustViewerAuth(ctx: ToolExecutionContext) {
  return ctx.viewerAuth
}

function mustAuth(ctx: ToolExecutionContext) {
  return ctx.auth
}

const idSchema = z.object({ id: z.string().trim().min(1) })
const listSchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
})

// ── Tool-layer helpers: slim transformations for LLM/MCP consumers ──

const SLIM_DESC_MAX = 100

function slimDesc(s: string | null | undefined): string | null {
  if (!s) return null
  return s.length > SLIM_DESC_MAX ? s.slice(0, SLIM_DESC_MAX) + "…" : s
}

function slimPage(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, hasMore: page * pageSize < total }
}

function slimJobListResult(result: Awaited<ReturnType<typeof listJobs>>) {
  return {
    jobs: result.jobs.map((j) => ({
      id: j.id,
      status: j.status,
      workflowId: j.workflowId,
      workflowName: j.workflowName,
      ...(j.scheduleId ? { scheduleId: j.scheduleId } : {}),
      ...(j.batchId ? { batchId: j.batchId } : {}),
      attemptCount: j.attemptCount,
      maxAttempts: j.maxAttempts,
      runId: j.runId,
      runStatus: j.runStatus,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      ...(j.lastErrorCode ? { lastErrorCode: j.lastErrorCode } : {}),
    })),
    ...slimPage(result.total, result.page, result.pageSize),
  }
}

function slimOperationListResult(result: Awaited<ReturnType<typeof listOperations>>) {
  return {
    operations: result.operations.map((op) => ({
      id: op.id,
      status: op.status,
      action: op.action,
      source: op.source ?? null,
      targetType: op.targetType,
      targetId: op.targetId,
      ...(op.progress?.total != null ? { progress: { current: op.progress.current, total: op.progress.total } } : {}),
      ...(op.errorCode ? { errorCode: op.errorCode } : {}),
      createdAt: op.createdAt,
      completedAt: op.completedAt,
    })),
    ...slimPage(result.total, result.page, result.pageSize),
  }
}

const tools: RegisteredTool[] = [
  // workflows
  {
    name: "workflow_list",
    description: "List workflows (summary). Use workflow_get for full details.",
    inputSchema: listSchema.extend({
      sort: z.enum(["UPDATED_DESC", "UPDATED_ASC"]).default("UPDATED_DESC"),
      depsStatus: z.enum(["IDLE", "INSTALLING", "READY", "FAILED"]).optional(),
      envConfigured: z.enum(["CONFIGURED", "NOT_CONFIGURED"]).optional(),
      inputSpecConfigured: z.enum(["CONFIGURED", "NOT_CONFIGURED"]).optional(),
      outputsSpecConfigured: z.enum(["CONFIGURED", "NOT_CONFIGURED"]).optional(),
    }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const result = await listWorkflows({ viewerAuth: mustViewerAuth(ctx), query: input })
      return {
        workflows: result.workflows.map((w) => ({
          id: w.id,
          name: w.name,
          description: slimDesc(w.description),
          depsStatus: w.depsStatus,
          stepCount: w.stepCount,
          runCount: w.runCount,
          runningRunCount: w.runningRunCount,
          latestVersionNumber: w.latestVersionNumber,
          hasInputSpec: w.hasInputSpec,
          hasOutputsSpec: w.hasOutputsSpec,
          npmDepsCount: w.npmDepsCount,
          envCount: w.envCount,
          updatedAt: w.updatedAt,
          ...(w.lastRun
            ? { lastRun: { id: w.lastRun.id, status: w.lastRun.status, finishedAt: w.lastRun.finishedAt } }
            : {}),
          ...(w.recentSuccessRatePct != null ? { recentSuccessRatePct: w.recentSuccessRatePct } : {}),
        })),
        ...slimPage(result.total, result.page, result.pageSize),
      }
    },
  },
  {
    name: "workflow_get",
    description: "Get workflow details. Set includeCode=true to include step source code.",
    inputSchema: idSchema.extend({
      includeCode: z.boolean().optional().default(false).describe("Include step source code (scriptEsm)"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const workflow = await getWorkflowByPublicId({ viewerAuth: mustViewerAuth(ctx), workflowId: input.id })
      if (!workflow) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      return {
        workflow: {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          dependencies: workflow.dependencies,
          envJson: workflow.envJson,
          inputSpec: workflow.inputSpec,
          outputsSpec: workflow.outputsSpec,
          depsStatus: workflow.depsStatus,
          ...(workflow.depsErrorCode
            ? { depsErrorCode: workflow.depsErrorCode, depsErrorMessage: workflow.depsErrorMessage }
            : {}),
          createdAt: workflow.createdAt,
          updatedAt: workflow.updatedAt,
          steps: workflow.steps.map((s) => ({
            stepKey: s.stepKey,
            name: s.name,
            description: s.description,
            timeoutMs: s.timeoutMs,
            retryPolicy: s.retryPolicy,
            deps: s.deps,
            ...(input.includeCode ? { scriptEsm: s.scriptEsm } : {}),
          })),
        },
      }
    },
  },
  {
    name: "workflow_create",
    description: "Create a new workflow with steps, dependencies, env vars, and specs.",
    inputSchema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      dependencies: z.string().default("{}").describe('JSON object of npm dependencies, e.g. {"axios":"^1.0.0"}'),
      envJson: z.string().default("{}").describe('JSON object of env vars, e.g. {"API_KEY":"xxx"}'),
      inputSpec: z.string().nullable().optional().describe("Workflow input spec JSON"),
      outputsSpec: z.string().nullable().optional().describe("Workflow outputs spec JSON"),
      steps: z
        .array(
          z.object({
            stepKey: z.string().min(1),
            name: z.string().min(1),
            description: z.string().optional(),
            scriptEsm: z.string().default(""),
            timeoutMs: z.number().int().positive().optional(),
            retryPolicy: z.unknown().optional(),
            deps: z.array(z.string().min(1)).default([]).describe("Step keys this step depends on"),
          }),
        )
        .default([]),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const auth = mustAuth(ctx)
      const body = input as {
        name: string
        description?: string
        dependencies: string
        envJson: string
        inputSpec?: string | null
        outputsSpec?: string | null
        steps: Array<{
          stepKey: string
          name: string
          description?: string
          scriptEsm: string
          timeoutMs?: number
          retryPolicy?: unknown
          deps: string[]
        }>
      }
      await ensureEngineRunning()
      let userDeps: Record<string, string>
      try {
        userDeps = parseDependenciesJson(body.dependencies)
      } catch {
        throw new ToolExecutionError("INVALID_DEPENDENCIES", "INVALID_DEPENDENCIES", { field: "dependencies" })
      }
      const hash = depsHash(userDeps)
      const depsStatus = Object.keys(userDeps).length === 0 ? "READY" : "IDLE"
      let envJsonNormalized = "{}"
      try {
        const parsed = JSON.parse(body.envJson || "{}")
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("envJson must be object")
        const keyRe = /^[A-Za-z_][A-Za-z0-9_]*$/
        const obj: Record<string, string> = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          const key = String(k).trim()
          if (!key) continue
          if (!keyRe.test(key)) throw new Error("bad env key")
          if (typeof v !== "string") throw new Error("bad env value")
          obj[key] = v
        }
        envJsonNormalized = JSON.stringify(
          Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))),
          null,
          2,
        )
      } catch {
        throw new ToolExecutionError("INVALID_ENV_JSON", "INVALID_ENV_JSON", { field: "envJson" })
      }
      const steps = body.steps ?? []
      const graphOk = validateWorkflowGraph(steps)
      if (!graphOk.ok) {
        const mapped = workflowGraphValidationErrorToApiError(graphOk.error)
        throw new ToolExecutionError(mapped.code, mapped.code, mapped.meta as Record<string, unknown> | undefined)
      }

      let inputSpec: string | null =
        typeof body.inputSpec === "string" && body.inputSpec.trim().length ? body.inputSpec.trim() : null
      if (inputSpec) {
        try {
          const j = JSON.parse(inputSpec) as unknown
          if (
            j &&
            typeof j === "object" &&
            !Array.isArray(j) &&
            Object.keys(j as Record<string, unknown>).length === 0
          ) {
            inputSpec = null
          }
        } catch {}
      }
      if (inputSpec) {
        const parsed = parseWorkflowInputSpec(inputSpec)
        if (!parsed.spec) {
          if (parsed.reservedKeys?.length) {
            throw new ToolExecutionError("INVALID_INPUT_SPEC_RESERVED_FIELDS", "INVALID_INPUT_SPEC_RESERVED_FIELDS", {
              field: "inputSpec",
              reservedKeys: parsed.reservedKeys,
            })
          }
          throw new ToolExecutionError("INVALID_INPUT_SPEC", "INVALID_INPUT_SPEC", { field: "inputSpec" })
        }
        const compiled = compileJsonSchema(parsed.spec.paramsSchema)
        if (compiled.compileError)
          throw new ToolExecutionError("INVALID_INPUT_SPEC_SCHEMA", "INVALID_INPUT_SPEC_SCHEMA", { field: "inputSpec" })
        inputSpec = JSON.stringify(parsed.spec, null, 2)
      }

      let outputsSpec: string | null =
        typeof body.outputsSpec === "string" && body.outputsSpec.trim().length ? body.outputsSpec.trim() : null
      if (outputsSpec) {
        try {
          const j = JSON.parse(outputsSpec) as unknown
          if (
            j &&
            typeof j === "object" &&
            !Array.isArray(j) &&
            Object.keys(j as Record<string, unknown>).length === 0
          ) {
            outputsSpec = null
          }
        } catch {}
      }
      if (outputsSpec) {
        const parsed = parseWorkflowOutputsSpec(outputsSpec)
        if (!parsed.spec)
          throw new ToolExecutionError("INVALID_OUTPUTS_SPEC", "INVALID_OUTPUTS_SPEC", { field: "outputsSpec" })
        outputsSpec = JSON.stringify(parsed.spec, null, 2)
      }

      const id = crypto.randomUUID()
      const workflow = await prisma.$transaction(async (tx) => {
        const pub = await allocatePublicId(tx, "workflow")
        const wf = await tx.workflow.create({
          data: {
            id,
            publicId: pub.publicId,
            publicNumber: pub.publicNumber,
            name: body.name,
            description: body.description ?? null,
            ...makeCreateAudit(auth),
            dependencies: body.dependencies,
            envJson: envJsonNormalized,
            inputSpec,
            outputsSpec,
            depsHash: hash,
            depsStatus,
            depsErrorCode: null,
            depsErrorMessage: null,
            depsErrorMetaJson: null,
            depsErrorAt: null,
          },
        })
        if (steps.length) {
          await tx.workflowStep.createMany({
            data: steps.map((s) => ({
              id: crypto.randomUUID(),
              workflowId: id,
              key: s.stepKey,
              name: s.name,
              description: s.description ?? null,
              scriptEsm: s.scriptEsm,
              timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
              retryPolicyJson: JSON.stringify(s.retryPolicy ?? {}),
            })),
          })
          const depEdges: { stepId: string; dependsOnStepId: string }[] = []
          for (const s of steps) for (const d of s.deps) depEdges.push({ stepId: s.stepKey, dependsOnStepId: d })
          if (depEdges.length) {
            await tx.workflowStepDep.createMany({
              data: depEdges.map((e) => ({
                id: crypto.randomUUID(),
                workflowId: id,
                stepId: e.stepId,
                dependsOnStepId: e.dependsOnStepId,
              })),
            })
          }
        }
        return wf
      })
      await createWorkflowVersionSnapshot({
        workflowId: workflow.id,
        workflowName: workflow.name,
        description: null,
        createdByUserId: auth.userId,
        dependencies: workflow.dependencies,
        envJson: workflow.envJson ?? "{}",
        inputSpec: workflow.inputSpec ?? null,
        outputsSpec: workflow.outputsSpec ?? null,
        depsHash: workflow.depsHash,
        steps: steps.map((s) => ({
          stepKey: s.stepKey,
          name: s.name,
          scriptEsm: s.scriptEsm,
          timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
          retryPolicy: s.retryPolicy ?? undefined,
          deps: s.deps ?? [],
        })),
      })
      return {
        workflow: {
          id: workflow.publicId,
          publicId: workflow.publicId,
          publicNumber: workflow.publicNumber,
          name: workflow.name,
          description: workflow.description ?? null,
        },
      }
    },
  },
  {
    name: "workflow_update",
    description:
      "Full update of a workflow (name, description, dependencies, env, steps). Use workflow_patch for partial metadata updates.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Public ID of the workflow, e.g. wf-1"),
      name: z.string().min(1),
      description: z.string().optional(),
      dependencies: z.string().optional().describe("JSON object of npm deps"),
      envJson: z.string().optional().describe("JSON object of env vars"),
      inputSpec: z.string().nullable().optional(),
      outputsSpec: z.string().nullable().optional(),
      steps: z
        .array(
          z.object({
            stepKey: z.string().min(1),
            name: z.string().min(1),
            description: z.string().optional(),
            scriptEsm: z.string().default(""),
            timeoutMs: z.number().int().positive().optional(),
            deps: z.array(z.string().min(1)).default([]),
          }),
        )
        .optional(),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const body = { ...input }
      const { id: workflowId, ...rest } = body as Record<string, unknown>
      const result = await updateWorkflowByPublicId({
        auth: mustAuth(ctx),
        viewerAuth: mustViewerAuth(ctx),
        workflowId: String(workflowId),
        body: rest as any,
      })
      if (!result.ok) throw new ToolExecutionError(result.code, result.code, result.meta)
      return { workflow: result.workflow }
    },
  },
  {
    name: "workflow_patch",
    description: "Patch workflow metadata",
    inputSchema: z.object({
      id: z.string().min(1),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const result = await patchWorkflowMetaByPublicId({
        auth: mustAuth(ctx),
        viewerAuth: mustViewerAuth(ctx),
        workflowId: input.id,
        body: { name: input.name, description: input.description },
      })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { workflow: result.workflow }
    },
  },
  {
    name: "workflow_delete",
    description: "Delete workflow",
    inputSchema: idSchema,
    riskLevel: "destructive",
    execute: async (ctx, input) => {
      const result = await deleteWorkflowByPublicId({ viewerAuth: mustViewerAuth(ctx), workflowId: input.id })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true }
    },
  },
  {
    name: "workflow_meta_get",
    description: "Get workflow metadata",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const wf = await prisma.workflow.findFirst({
        where: getWorkflowFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true, publicId: true, name: true },
      })
      if (!wf) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      const meta = await getWorkflowDraftMeta(wf.id)
      return {
        workflow: {
          id: wf.publicId,
          publicId: wf.publicId,
          name: wf.name,
          latestVersionNumber: meta.latestVersionNumber,
          hasUnpublishedChanges: meta.hasUnpublishedChanges,
        },
      }
    },
  },
  {
    name: "workflow_export",
    description: "Export workflow",
    inputSchema: idSchema.extend({
      includeEnv: z.boolean().optional().default(false),
      version: z.number().int().positive().optional(),
    }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const workflowPublicId = String(input.id).trim().toLowerCase()
      const wf = await prisma.workflow.findFirst({
        where: getWorkflowFindFirstWhereByPublicId(mustViewerAuth(ctx), workflowPublicId),
        select: {
          id: true,
          publicId: true,
          name: true,
          description: true,
          dependencies: true,
          envJson: true,
          inputSpec: true,
          outputsSpec: true,
        },
      })
      if (!wf) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      if (typeof input.version === "number") {
        const row = await prisma.workflowVersion.findFirst({
          where: { workflowId: wf.id, version: input.version },
          select: { version: true, snapshotJson: true, createdAt: true, description: true },
        })
        if (!row) throw new ToolExecutionError("WORKFLOW_VERSION_NOT_FOUND")
        const snap = workflowSnapshotSchema.parse(JSON.parse(row.snapshotJson || "{}"))
        const dependencies = (() => {
          try {
            const obj = JSON.parse(snap.dependencies || "{}")
            return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, string>) : {}
          } catch {
            return {}
          }
        })()
        const env = input.includeEnv
          ? (() => {
              try {
                const obj = JSON.parse(snap.envJson || "{}")
                return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, string>) : {}
              } catch {
                return {}
              }
            })()
          : {}
        const safe = (raw: string | null | undefined) => {
          if (typeof raw !== "string" || !raw.trim()) return null
          try {
            return JSON.parse(raw)
          } catch {
            return raw
          }
        }
        return {
          format: "maia.workflow.export.v1",
          exportedAt: new Date().toISOString(),
          workflow: { id: wf.publicId, name: snap.workflowName || wf.name, description: wf.description ?? null },
          version: {
            number: row.version,
            createdAt: row.createdAt ? row.createdAt.toISOString() : null,
            description: row.description ?? null,
          },
          flags: { envIncluded: input.includeEnv },
          data: {
            meta: {
              name: snap.workflowName || wf.name,
              description: wf.description ?? null,
              reservedInitialInputKeys: snap.reservedInitialInputKeys ?? undefined,
            },
            steps: snap.steps,
            env,
            dependencies,
            inputSpec: safe(snap.inputSpec),
            outputsSpec: safe(snap.outputsSpec),
          },
        }
      }
      const steps = await prisma.workflowStep.findMany({ where: { workflowId: wf.id }, orderBy: [{ key: "asc" }] })
      const deps = await prisma.workflowStepDep.findMany({ where: { workflowId: wf.id } })
      const depMap = new Map<string, string[]>()
      for (const d of deps) {
        const arr = depMap.get(d.stepId) ?? []
        arr.push(d.dependsOnStepId)
        depMap.set(d.stepId, arr)
      }
      const parseMap = (raw: string | null | undefined) => {
        try {
          const obj = JSON.parse(typeof raw === "string" ? raw : "{}")
          return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, string>) : {}
        } catch {
          return {}
        }
      }
      const safe = (raw: string | null | undefined) => {
        if (typeof raw !== "string" || !raw.trim()) return null
        try {
          return JSON.parse(raw)
        } catch {
          return raw
        }
      }
      return {
        format: "maia.workflow.export.v1",
        exportedAt: new Date().toISOString(),
        workflow: { id: wf.publicId, name: wf.name, description: wf.description ?? null },
        version: null,
        flags: { envIncluded: input.includeEnv },
        data: {
          meta: { name: wf.name, description: wf.description ?? null },
          steps: steps.map((s) => ({
            stepKey: s.key,
            name: s.name,
            scriptEsm: s.scriptEsm,
            timeoutMs: s.timeoutMs,
            deps: depMap.get(s.key) ?? [],
          })),
          env: input.includeEnv ? parseMap(wf.envJson) : {},
          dependencies: parseMap(wf.dependencies),
          inputSpec: safe(wf.inputSpec),
          outputsSpec: safe(wf.outputsSpec),
        },
      }
    },
  },
  {
    name: "workflow_deps_install",
    description: "Install workflow dependencies",
    inputSchema: idSchema,
    riskLevel: "write",
    execute: async (ctx, input) => {
      await ensureEngineRunning()
      const wf = await prisma.workflow.findFirst({
        where: getWorkflowFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true },
      })
      if (!wf) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      await ensureWorkflowDepsInstalled(wf.id, { signal: new AbortController().signal })
      return { ok: true }
    },
  },
  {
    name: "workflow_deps_log_list",
    description: "List dependency install logs",
    inputSchema: idSchema.extend({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(200).default(20),
      mode: z.enum(["latest", "all"]).optional().default("latest"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const wf = await prisma.workflow.findFirst({
        where: getWorkflowFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true },
      })
      if (!wf) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      const prefix = `[workflow:${wf.id}] `
      const rows = await prisma.logEvent.findMany({
        where: { runId: null, source: LogSource.INSTALL, message: { startsWith: prefix } },
        orderBy: [{ id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: { id: true, level: true, message: true, createdAt: true },
      })
      const logs = rows
        .slice()
        .reverse()
        .map((r) => ({
          id: `log:${String(r.id)}`,
          level: r.level,
          createdAt: r.createdAt,
          message: r.message.startsWith(prefix) ? r.message.slice(prefix.length) : r.message,
        }))
      if (input.mode === "all") return { logs }
      const startNeedle = "pnpm install (prod) starting"
      let lastStartIdx = -1
      for (let i = logs.length - 1; i >= 0; i--)
        if (String(logs[i]?.message ?? "").includes(startNeedle)) {
          lastStartIdx = i
          break
        }
      return { logs: lastStartIdx >= 0 ? logs.slice(lastStartIdx) : logs }
    },
  },
  {
    name: "workflow_version_list",
    description: "List workflow versions",
    inputSchema: idSchema.extend({
      q: z.string().trim().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(20),
      sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const wf = await prisma.workflow.findFirst({
        where: getWorkflowFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true, publicId: true, name: true },
      })
      if (!wf) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      const q = (input.q ?? "").trim()
      const m = q.match(/^v?(\\d+)$/i)
      const qVersion = m ? Number(m[1]) : null
      const where =
        q && q.length
          ? {
              workflowId: wf.id,
              OR: [
                ...(Number.isFinite(qVersion) ? [{ version: qVersion as number }] : []),
                { description: { contains: q } },
              ],
            }
          : { workflowId: wf.id }
      const total = await prisma.workflowVersion.count({ where })
      const orderBy =
        input.sort === "CREATED_ASC"
          ? [{ createdAt: "asc" as const }, { version: "asc" as const }]
          : [{ createdAt: "desc" as const }, { version: "desc" as const }]
      const versions = await prisma.workflowVersion.findMany({
        where,
        orderBy,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: { version: true, snapshotJson: true, description: true, createdAt: true },
      })
      return {
        workflow: { id: wf.publicId, publicId: wf.publicId, name: wf.name },
        total,
        page: input.page,
        pageSize: input.pageSize,
        sort: input.sort,
        q: input.q ?? "",
        versions: versions.map((v) => {
          let snap: Record<string, unknown> | null = null
          try {
            snap = JSON.parse(v.snapshotJson || "{}") as Record<string, unknown>
          } catch {}
          const steps = Array.isArray(snap?.steps) ? snap.steps : []
          const depsEdgesCount = steps.reduce(
            (n, s) =>
              n +
              (Array.isArray((s as Record<string, unknown>)?.deps)
                ? ((s as Record<string, unknown>).deps as unknown[]).length
                : 0),
            0,
          )
          const depsPackagesCount = (() => {
            try {
              const d = JSON.parse(String((snap?.dependencies as string) || "{}"))
              return d && typeof d === "object" && !Array.isArray(d)
                ? Object.keys(d as Record<string, unknown>).length
                : 0
            } catch {
              return 0
            }
          })()
          const envVarsCount = (() => {
            try {
              const d = JSON.parse(String((snap?.envJson as string) || "{}"))
              return d && typeof d === "object" && !Array.isArray(d)
                ? Object.keys(d as Record<string, unknown>).length
                : 0
            } catch {
              return 0
            }
          })()
          return {
            id: `${wf.publicId}:v${v.version}`,
            version: v.version,
            createdAt: v.createdAt,
            description: v.description ?? null,
            stepsCount: steps.length,
            depsEdgesCount,
            depsHash: typeof snap?.depsHash === "string" ? String(snap.depsHash) : null,
            depsPackagesCount,
            envVarsCount,
            inputSpecConfigured: typeof snap?.inputSpec === "string" && String(snap.inputSpec).trim().length > 0,
            outputsSpecConfigured: typeof snap?.outputsSpec === "string" && String(snap.outputsSpec).trim().length > 0,
          }
        }),
      }
    },
  },
  {
    name: "workflow_version_create_snapshot",
    description: "Create workflow snapshot version",
    inputSchema: idSchema.extend({ description: z.string().max(5000).optional().nullable() }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const auth = mustAuth(ctx)
      const wf = await prisma.workflow.findFirst({
        where: getWorkflowFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: {
          id: true,
          publicId: true,
          name: true,
          dependencies: true,
          envJson: true,
          inputSpec: true,
          outputsSpec: true,
          depsHash: true,
        },
      })
      if (!wf) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      const steps = await prisma.workflowStep.findMany({ where: { workflowId: wf.id }, orderBy: [{ key: "asc" }] })
      const deps = await prisma.workflowStepDep.findMany({ where: { workflowId: wf.id } })
      const depMap = new Map<string, string[]>()
      for (const d of deps) {
        const arr = depMap.get(d.stepId) ?? []
        arr.push(d.dependsOnStepId)
        depMap.set(d.stepId, arr)
      }
      const snapSteps = steps.map((s) => ({
        stepKey: s.key,
        name: s.name,
        scriptEsm: s.scriptEsm ?? "",
        timeoutMs: s.timeoutMs,
        retryPolicy: normalizeRetryPolicyJson(s.retryPolicyJson),
        deps: depMap.get(s.key) ?? [],
      }))
      const graphOk = validateWorkflowGraph(snapSteps.map(({ retryPolicy: _rp, ...rest }) => rest))
      if (!graphOk.ok) {
        const mapped = workflowGraphValidationErrorToApiError(graphOk.error)
        throw new ToolExecutionError(mapped.code, mapped.code, mapped.meta as Record<string, unknown> | undefined)
      }
      const descTrimmed = typeof input.description === "string" ? input.description.trim() : ""
      const created = await createWorkflowVersionSnapshot({
        workflowId: wf.id,
        workflowName: wf.name,
        description: descTrimmed.length ? descTrimmed : null,
        createdByUserId: auth.userId,
        dependencies: wf.dependencies,
        envJson: wf.envJson ?? "{}",
        inputSpec: wf.inputSpec ?? null,
        outputsSpec: wf.outputsSpec ?? null,
        depsHash: wf.depsHash,
        steps: snapSteps,
      })
      return {
        workflow: { id: wf.publicId, publicId: wf.publicId, name: wf.name },
        version: { version: created.version, createdAt: created.createdAt },
      }
    },
  },
  {
    name: "workflow_version_get",
    description: "Get workflow version",
    inputSchema: z.object({ id: z.string().min(1), version: z.number().int().positive() }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const wf = await prisma.workflow.findFirst({
        where: getWorkflowFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true, publicId: true, name: true },
      })
      if (!wf) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      const row = await prisma.workflowVersion.findFirst({
        where: { workflowId: wf.id, version: input.version },
        select: { version: true, snapshotJson: true, description: true, createdAt: true },
      })
      if (!row) throw new ToolExecutionError("WORKFLOW_VERSION_NOT_FOUND")
      let snapshot: unknown = null
      try {
        snapshot = workflowSnapshotSchema.parse(JSON.parse(row.snapshotJson || "{}"))
      } catch {}
      return {
        workflow: { id: wf.publicId, publicId: wf.publicId, name: wf.name },
        version: {
          id: `${wf.publicId}:v${row.version}`,
          version: row.version,
          createdAt: row.createdAt,
          description: row.description ?? null,
          snapshot,
          snapshotJson: row.snapshotJson,
          reservedInitialInputKeys:
            (snapshot as { reservedInitialInputKeys?: string[] } | null)?.reservedInitialInputKeys ?? null,
        },
      }
    },
  },
  {
    name: "workflow_version_restore",
    description: "Restore workflow version",
    inputSchema: z.object({ id: z.string().min(1), version: z.number().int().positive() }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const auth = mustAuth(ctx)
      await ensureEngineRunning()
      const wf = await prisma.workflow.findFirst({
        where: getWorkflowFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
      })
      if (!wf) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      const row = await prisma.workflowVersion.findFirst({ where: { workflowId: wf.id, version: input.version } })
      if (!row) throw new ToolExecutionError("WORKFLOW_VERSION_NOT_FOUND")
      let snap: ReturnType<typeof workflowSnapshotSchema.parse>
      try {
        snap = workflowSnapshotSchema.parse(JSON.parse(row.snapshotJson || "{}"))
      } catch {
        throw new ToolExecutionError("INVALID_SNAPSHOT")
      }
      const graphOk = validateWorkflowGraph(snap.steps ?? [])
      if (!graphOk.ok)
        throw new ToolExecutionError(
          "INVALID_SNAPSHOT",
          "INVALID_SNAPSHOT",
          workflowGraphValidationErrorToInvalidSnapshotMeta(graphOk.error) as Record<string, unknown>,
        )
      let depsObj: Record<string, string> = {}
      try {
        depsObj = parseDependenciesJson(snap.dependencies || "{}")
      } catch {
        throw new ToolExecutionError("INVALID_SNAPSHOT", "INVALID_SNAPSHOT", { field: "dependencies" })
      }
      const dHash = depsHash(depsObj)
      const depsStatus = Object.keys(depsObj).length === 0 ? "READY" : "IDLE"
      await prisma.$transaction(async (tx) => {
        await tx.workflow.update({
          where: { id: wf.id },
          data: {
            name: snap.workflowName ?? wf.name,
            dependencies: snap.dependencies ?? "{}",
            envJson: snap.envJson ?? "{}",
            inputSpec: snap.inputSpec ?? null,
            outputsSpec: snap.outputsSpec ?? null,
            depsHash: dHash,
            depsStatus,
            depsErrorCode: null,
            depsErrorMessage: null,
            depsErrorMetaJson: null,
            depsErrorAt: null,
            depsUpdatedAt: new Date(),
          },
        })
        await tx.workflowStepDep.deleteMany({ where: { workflowId: wf.id } })
        await tx.workflowStep.deleteMany({ where: { workflowId: wf.id } })
        if (snap.steps?.length) {
          await tx.workflowStep.createMany({
            data: snap.steps.map((s) => ({
              id: crypto.randomUUID(),
              workflowId: wf.id,
              key: s.stepKey,
              name: s.name,
              description: null,
              scriptEsm: s.scriptEsm ?? "",
              timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
              retryPolicyJson: JSON.stringify(normalizeRetryPolicyObject(s.retryPolicy) ?? {}),
            })),
          })
          const edges: { stepId: string; dependsOnStepId: string }[] = []
          for (const s of snap.steps)
            for (const d of s.deps ?? []) edges.push({ stepId: s.stepKey, dependsOnStepId: d })
          if (edges.length) {
            await tx.workflowStepDep.createMany({
              data: edges.map((e) => ({
                id: crypto.randomUUID(),
                workflowId: wf.id,
                stepId: e.stepId,
                dependsOnStepId: e.dependsOnStepId,
              })),
            })
          }
        }
      })
      const created = await createWorkflowVersionSnapshot({
        workflowId: wf.id,
        workflowName: snap.workflowName ?? wf.name,
        description: `Restored from v${String(row.version)}`,
        createdByUserId: auth.userId,
        dependencies: snap.dependencies ?? "{}",
        envJson: snap.envJson ?? "{}",
        inputSpec: snap.inputSpec ?? null,
        outputsSpec: snap.outputsSpec ?? null,
        depsHash: dHash,
        steps: (snap.steps ?? []).map((s) => ({
          stepKey: s.stepKey,
          name: s.name,
          scriptEsm: s.scriptEsm ?? "",
          timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
          retryPolicy: normalizeRetryPolicyObject(s.retryPolicy),
          deps: s.deps ?? [],
        })),
      })
      return {
        ok: true,
        restoredFrom: { version: row.version },
        createdVersion: { version: created.version, createdAt: created.createdAt },
      }
    },
  },

  // runs
  {
    name: "run_list",
    description: "List runs (summary). Use run_get for full details.",
    inputSchema: listSchema.extend({
      status: z.enum(["PENDING_INPUTS", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
      sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const result = await listRuns({ viewerAuth: mustViewerAuth(ctx), query: input })
      return {
        runs: result.runs.map((r) => ({
          id: r.id,
          workflowId: r.workflowId,
          workflowName: r.workflowName,
          status: r.status,
          stepsTotal: r.stepsTotal,
          stepsDone: r.stepsDone,
          ...(r.runningStepName ? { runningStepName: r.runningStepName } : {}),
          ...(r.failedStepName ? { failedStepName: r.failedStepName } : {}),
          ...(r.failureCode ? { failureCode: r.failureCode } : {}),
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
        })),
        ...slimPage(result.total, result.page, result.pageSize),
      }
    },
  },
  {
    name: "run_get",
    description: "Get run detail",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const run = await getRunByPublicId({ viewerAuth: mustViewerAuth(ctx), runId: input.id })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      return { run }
    },
  },
  {
    name: "run_delete",
    description: "Delete run",
    inputSchema: idSchema,
    riskLevel: "destructive",
    execute: async (ctx, input) => {
      const result = await deleteRunByPublicId({ viewerAuth: mustViewerAuth(ctx), runId: input.id })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true }
    },
  },
  {
    name: "run_cancel",
    description: "Cancel run",
    inputSchema: idSchema.extend({ reason: z.string().optional() }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const result = await cancelRunByPublicId({
        viewerAuth: mustViewerAuth(ctx),
        runId: input.id,
        reason: input.reason ?? null,
      })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true }
    },
  },
  {
    name: "run_force_stop",
    description: "Force stop run",
    inputSchema: idSchema,
    riskLevel: "destructive",
    execute: async (ctx, input) => {
      const result = await forceStopRunByPublicId({ viewerAuth: mustViewerAuth(ctx), runId: input.id })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true }
    },
  },
  {
    name: "run_attempt_list",
    description: "List run attempts",
    inputSchema: idSchema.extend({ stepKey: z.string().trim().min(1) }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      const attempts = await prisma.attempt.findMany({
        where: { runId: run.id, stepKey: input.stepKey },
        orderBy: [{ attemptNo: "asc" }],
        select: {
          stepKey: true,
          attemptNo: true,
          status: true,
          exitCode: true,
          errorCode: true,
          errorMessage: true,
          errorMetaJson: true,
          errorAt: true,
          startedAt: true,
          finishedAt: true,
        },
      })
      return { attempts }
    },
  },
  {
    name: "run_inputs_get",
    description: "Get run inputs",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { initialInput: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      if (!run.initialInput) return { available: false, code: "NO_RUN_INPUTS", initialInput: null }
      return { available: true, code: null, initialInput: run.initialInput }
    },
  },
  {
    name: "run_outputs_get",
    description: "Get run outputs",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true, workflowSnap: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      const snap = workflowSnapshotSchema.safeParse(JSON.parse(run.workflowSnap || "{}"))
      const parsed = parseWorkflowOutputsSpec(snap.success ? (snap.data.outputsSpec ?? null) : null)
      if (!parsed.spec)
        return {
          outputs: null,
          spec: null,
          error: parsed.error ?? null,
          reservedInitialInputKeys: snap.success ? (snap.data.reservedInitialInputKeys ?? null) : null,
        }
      const spec = parsed.spec
      const out: Record<string, unknown> = {}
      const sources: Record<string, { stepKey: string; field?: string; attemptNo: number | null }> = {}
      for (const [name, def] of Object.entries(spec.outputs ?? {})) {
        const stepKey = String(def?.stepKey ?? "").trim()
        const field = def?.field ? String(def.field).trim() : undefined
        if (!stepKey) {
          out[name] = null
          sources[name] = { stepKey: "", field, attemptNo: null }
          continue
        }
        const last = await prisma.attempt.findFirst({
          where: { runId: run.id, stepKey, status: AttemptStatus.SUCCEEDED },
          orderBy: [{ attemptNo: "desc" }],
          select: { attemptNo: true },
        })
        if (!last) {
          out[name] = null
          sources[name] = { stepKey, field, attemptNo: null }
          continue
        }
        const p = path.join(attemptDir(run.id, stepKey, last.attemptNo), "output.json")
        const outputJson = (await readJsonFileOrNull<Record<string, unknown>>(p)) ?? {}
        const outputsObj = (outputJson?.data as Record<string, unknown> | undefined)?.outputs as
          | Record<string, unknown>
          | undefined
        out[name] = field ? (outputsObj?.[field] ?? null) : (outputsObj ?? null)
        sources[name] = { stepKey, field, attemptNo: last.attemptNo }
      }
      return {
        outputs: out,
        spec,
        sources,
        reservedInitialInputKeys: snap.success ? (snap.data.reservedInitialInputKeys ?? null) : null,
      }
    },
  },
  {
    name: "run_artifact_list",
    description: "List run artifacts",
    inputSchema: idSchema.extend({ stepKey: z.string().trim().min(1).optional() }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const runPublicId = String(input.id).trim().toLowerCase()
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), runPublicId),
        select: { id: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      const artifacts = await prisma.artifact.findMany({
        where: { runId: run.id, ...(input.stepKey ? { stepKey: input.stepKey } : {}) },
        orderBy: [{ createdAt: "desc" }],
        take: 200,
        select: {
          id: true,
          stepKey: true,
          attemptNo: true,
          kind: true,
          path: true,
          sizeBytes: true,
          sha256: true,
          summary: true,
          createdAt: true,
        },
      })
      return {
        artifacts: artifacts.map((a) => ({
          id: a.id,
          artifactInternalId: a.id,
          runId: runPublicId,
          stepKey: a.stepKey,
          attemptNo: a.attemptNo,
          kind: a.kind,
          path: a.path,
          sizeBytes: a.sizeBytes ?? null,
          sha256: a.sha256 ?? null,
          summary: a.summary ?? null,
          createdAt: a.createdAt,
        })),
      }
    },
  },
  {
    name: "run_artifact_download",
    description: "Download run artifact",
    inputSchema: idSchema.extend({ artifactId: z.string().min(1), name: z.string().optional() }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const runPublicId = String(input.id).trim().toLowerCase()
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), runPublicId),
        select: { id: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      const artifact = await prisma.artifact.findFirst({
        where: { id: input.artifactId, runId: run.id },
        select: { id: true },
      })
      if (!artifact) throw new ToolExecutionError("ARTIFACT_NOT_FOUND")
      return {
        ok: true,
        downloadPath: `/api/runs/${runPublicId}/artifacts/download?artifactId=${encodeURIComponent(input.artifactId)}${input.name ? `&name=${encodeURIComponent(input.name)}` : ""}`,
      }
    },
  },
  {
    name: "run_input_file_list",
    description: "List run input files",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const runPublicId = String(input.id).trim().toLowerCase()
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), runPublicId),
        select: { id: true, publicId: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      const job = await prisma.jobRun.findFirst({
        where: { runId: run.id },
        select: {
          publicId: true,
          inputFiles: {
            orderBy: [{ createdAt: "asc" }],
            select: {
              id: true,
              name: true,
              source: true,
              status: true,
              url: true,
              error: true,
              sha256: true,
              sizeBytes: true,
              mime: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      })
      if (!job) return { runId: run.publicId, jobId: null, inputFiles: [] }
      return {
        runId: run.publicId,
        jobId: job.publicId,
        inputFiles: job.inputFiles.map((f) => ({
          id: f.id,
          name: f.name,
          source: f.source,
          status: f.status,
          url: f.url ?? null,
          error: f.error ?? null,
          sha256: f.sha256 ?? null,
          sizeBytes: typeof f.sizeBytes === "number" ? f.sizeBytes : null,
          mime: f.mime ?? null,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        })),
      }
    },
  },
  {
    name: "run_file_download",
    description: "Download run file",
    inputSchema: idSchema.extend({ fileId: z.string().min(1), name: z.string().optional() }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const runPublicId = String(input.id).trim().toLowerCase()
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), runPublicId),
        select: { id: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      const rel = String(input.fileId || "")
        .trim()
        .replaceAll("\\", "/")
      if (!rel || rel.startsWith("/") || rel.includes("..") || !rel.startsWith("uploads/"))
        throw new ToolExecutionError("INVALID_PATH")
      return {
        ok: true,
        downloadPath: `/api/runs/${runPublicId}/files/download?path=${encodeURIComponent(rel)}${input.name ? `&name=${encodeURIComponent(input.name)}` : ""}`,
      }
    },
  },
  {
    name: "run_step_definition_get",
    description: "Get run step definition",
    inputSchema: idSchema.extend({ stepKey: z.string().min(1) }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const runPublicId = String(input.id).trim().toLowerCase()
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), runPublicId),
        select: {
          id: true,
          workflowName: true,
          workflowVersionNumber: true,
          workflow: { select: { publicId: true } },
          workflowSnap: true,
        },
      })
      if (!run) return { available: false, code: "RUN_NOT_FOUND", run: null, step: null }
      const runStep = await prisma.runStep.findUnique({
        where: { runId_stepKey: { runId: run.id, stepKey: input.stepKey } },
        select: { stepKey: true, name: true, depsJson: true, timeoutMs: true, scriptEsm: true },
      })
      if (!runStep) return { available: false, code: "NO_STEP_DEFINITION", run: null, step: null }
      let snap: Record<string, unknown> | null = null
      try {
        snap = JSON.parse(run.workflowSnap || "{}")
      } catch {}
      const depsPackagesCount = (() => {
        try {
          const d = JSON.parse(String((snap?.dependencies as string) || "{}"))
          return d && typeof d === "object" && !Array.isArray(d)
            ? Object.keys(d as Record<string, unknown>).length
            : null
        } catch {
          return null
        }
      })()
      return {
        available: true,
        code: null,
        run: {
          id: runPublicId,
          workflowId: run.workflow?.publicId ?? null,
          workflowName: run.workflowName,
          workflowVersionNumber: run.workflowVersionNumber ?? null,
          depsHash: typeof snap?.depsHash === "string" ? snap.depsHash : null,
          depsPackagesCount,
        },
        step: {
          stepKey: runStep.stepKey,
          name: runStep.name,
          deps: (() => {
            try {
              const d = JSON.parse(runStep.depsJson || "[]")
              return Array.isArray(d) ? d : []
            } catch {
              return []
            }
          })(),
          timeoutMs: runStep.timeoutMs,
          scriptEsm: runStep.scriptEsm ?? "",
        },
      }
    },
  },
  {
    name: "run_step_input_get",
    description: "Get run step input",
    inputSchema: idSchema.extend({ stepKey: z.string().min(1) }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true },
      })
      if (!run) return { available: false, code: "RUN_NOT_FOUND", attemptNo: null, input: null }
      const last = await prisma.attempt.findFirst({
        where: { runId: run.id, stepKey: input.stepKey },
        orderBy: [{ attemptNo: "desc" }],
        select: { attemptNo: true },
      })
      if (!last) return { available: false, code: "NO_STEP_INPUT", attemptNo: null, input: null }
      const p = path.join(attemptDir(run.id, input.stepKey, last.attemptNo), "input.json")
      const json = await readJsonFileOrNull(p)
      if (!json) return { available: false, code: "NO_STEP_INPUT", attemptNo: last.attemptNo, input: null }
      return { available: true, code: null, attemptNo: last.attemptNo, input: json }
    },
  },
  {
    name: "run_step_output_get",
    description: "Get run step output",
    inputSchema: idSchema.extend({ stepKey: z.string().min(1) }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true },
      })
      if (!run) return { available: false, code: "RUN_NOT_FOUND", attemptNo: null, output: null }
      const last = await prisma.attempt.findFirst({
        where: { runId: run.id, stepKey: input.stepKey, status: AttemptStatus.SUCCEEDED },
        orderBy: [{ attemptNo: "desc" }],
        select: { attemptNo: true },
      })
      if (!last) return { available: false, code: "NO_STEP_OUTPUT", attemptNo: null, output: null }
      const p = path.join(attemptDir(run.id, input.stepKey, last.attemptNo), "output.json")
      const json = await readJsonFileOrNull(p)
      if (!json) return { available: false, code: "NO_STEP_OUTPUT", attemptNo: last.attemptNo, output: null }
      return { available: true, code: null, attemptNo: last.attemptNo, output: json }
    },
  },
  {
    name: "run_step_artifact_list",
    description: "List run step artifacts",
    inputSchema: idSchema.extend({ stepKey: z.string().min(1) }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const runPublicId = String(input.id).trim().toLowerCase()
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), runPublicId),
        select: { id: true },
      })
      if (!run) return { artifacts: [] }
      const artifacts = await prisma.artifact.findMany({
        where: { runId: run.id, stepKey: input.stepKey },
        orderBy: [{ createdAt: "desc" }],
        take: 200,
        select: {
          id: true,
          stepKey: true,
          attemptNo: true,
          kind: true,
          path: true,
          sizeBytes: true,
          sha256: true,
          summary: true,
          createdAt: true,
        },
      })
      return {
        artifacts: artifacts.map((a) => ({
          id: a.id,
          artifactInternalId: a.id,
          runId: runPublicId,
          stepKey: a.stepKey,
          attemptNo: a.attemptNo,
          kind: a.kind,
          path: a.path,
          sizeBytes: a.sizeBytes ?? null,
          sha256: a.sha256 ?? null,
          summary: a.summary ?? null,
          createdAt: a.createdAt,
        })),
      }
    },
  },
  {
    name: "run_step_retry",
    description: "Retry run step",
    inputSchema: idSchema.extend({ stepKey: z.string().min(1) }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      const eng = await ensureEngineRunning()
      await eng.retryStep(run.id, input.stepKey)
      void eng.tick()
      return { ok: true }
    },
  },
  {
    name: "run_step_rerun",
    description: "Rerun run step",
    inputSchema: idSchema.extend({ stepKey: z.string().min(1) }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      const eng = await ensureEngineRunning()
      const res = await eng.rerunStep(run.id, input.stepKey)
      void eng.tick()
      const newRun = await prisma.run.findUnique({ where: { id: res.newRunId }, select: { publicId: true } })
      return { ok: true, newRunId: String(newRun?.publicId ?? res.newRunId) }
    },
  },
  {
    name: "run_step_restart",
    description: "Restart run step",
    inputSchema: idSchema.extend({ stepKey: z.string().min(1) }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const run = await prisma.run.findFirst({
        where: getRunFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: { id: true },
      })
      if (!run) throw new ToolExecutionError("RUN_NOT_FOUND")
      const eng = await ensureEngineRunning()
      const res = await eng.restartFromStep(run.id, input.stepKey)
      void eng.tick()
      const newRun = await prisma.run.findUnique({ where: { id: res.newRunId }, select: { publicId: true } })
      return { ok: true, newRunId: String(newRun?.publicId ?? res.newRunId) }
    },
  },

  // jobs
  {
    name: "job_list",
    description: "List jobs (summary). Use job_get for full details.",
    inputSchema: listSchema.extend({
      status: z.enum(["QUEUED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
      scheduleId: z.string().trim().min(1).optional(),
      batchId: z.string().trim().min(1).optional(),
      sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) => slimJobListResult(await listJobs({ viewerAuth: mustViewerAuth(ctx), query: input })),
  },
  {
    name: "job_get",
    description: "Get job detail",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const job = await getJobByPublicId({ viewerAuth: mustViewerAuth(ctx), jobId: input.id })
      if (!job) throw new ToolExecutionError("NOT_FOUND")
      return { job }
    },
  },
  {
    name: "job_create",
    description:
      "Create a job to run a workflow. Requires workflowId. inputJson should match the workflow's inputSpec paramsSchema.",
    inputSchema: z.object({
      workflowId: z.string().min(1).describe("Public ID of the workflow to run, e.g. wf-1"),
      inputJson: z.unknown().optional().default({}).describe("Input parameters matching the workflow inputSpec"),
      pinnedWorkflowVersionNumber: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Pin to a specific workflow version number"),
      start: z.boolean().optional().default(true).describe("Whether to start the job immediately"),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const auth = mustAuth(ctx)
      const viewerAuth = mustViewerAuth(ctx)
      const body = input as {
        workflowId: string
        inputJson: unknown
        pinnedWorkflowVersionNumber?: number
        start: boolean
      }
      const workflowPublicId = String(body.workflowId || "")
        .trim()
        .toLowerCase()
      const workflow =
        (await prisma.workflow.findFirst({
          where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
          select: { id: true, publicId: true },
        })) ??
        (await prisma.workflow.findFirst({
          where: getWorkflowFindFirstWhereById(viewerAuth, body.workflowId),
          select: { id: true, publicId: true },
        }))
      if (!workflow) throw new ToolExecutionError("WORKFLOW_NOT_FOUND")
      let pinnedWorkflowVersionId: string | null = null
      if (body.pinnedWorkflowVersionNumber != null) {
        const row = await prisma.workflowVersion.findUnique({
          where: { workflowId_version: { workflowId: workflow.id, version: body.pinnedWorkflowVersionNumber } },
          select: { id: true },
        })
        if (!row) throw new ToolExecutionError("INVALID_PINNED_WORKFLOW_VERSION")
        pinnedWorkflowVersionId = row.id
      }
      const version = pinnedWorkflowVersionId
        ? await prisma.workflowVersion.findUnique({
            where: { id: pinnedWorkflowVersionId },
            select: { snapshotJson: true },
          })
        : await getLatestWorkflowVersion(workflow.id)
      if (!version)
        throw new ToolExecutionError("WORKFLOW_VERSION_REQUIRED", "WORKFLOW_VERSION_REQUIRED", {
          workflowId: workflow.publicId,
        })
      const snapshot = workflowSnapshotSchema.parse(JSON.parse(version.snapshotJson || "{}"))
      const specParsed = parseWorkflowInputSpecWithOpts(snapshot.inputSpec ?? null, {
        reservedKeys: snapshot.reservedInitialInputKeys,
      })
      if (snapshot.inputSpec && !specParsed.spec) throw new ToolExecutionError("WORKFLOW_INPUT_SPEC_INVALID")
      const normalized =
        body.inputJson && typeof body.inputJson === "object" && !Array.isArray(body.inputJson)
          ? (body.inputJson as Record<string, unknown>)
          : { value: body.inputJson }
      const reserved = findReservedKeysInRecord(normalized, snapshot.reservedInitialInputKeys)
      if (reserved.length) throw new ToolExecutionError("INVALID_INPUT_JSON", "INVALID_INPUT_JSON", { reserved })
      if (specParsed.spec) {
        if (!body.inputJson || typeof body.inputJson !== "object" || Array.isArray(body.inputJson))
          throw new ToolExecutionError("INVALID_INPUT_JSON")
        const v = validateWithJsonSchema({ schema: specParsed.spec.paramsSchema, data: body.inputJson })
        if (!v.ok) throw new ToolExecutionError("INVALID_INPUT_JSON", "INVALID_INPUT_JSON", { issues: v.issues })
      }
      const pub = await allocatePublicId(prisma, "job")
      const now = new Date()
      const job = await prisma.jobRun.create({
        data: {
          id: crypto.randomUUID(),
          publicId: pub.publicId,
          publicNumber: pub.publicNumber,
          status: body.start ? "QUEUED" : "PAUSED",
          workflowId: workflow.id,
          pinnedWorkflowVersionId,
          requestedByUserId: auth.userId,
          queuedAt: body.start ? now : undefined,
          inputJson: JSON.stringify(normalized ?? {}),
          nextAttemptAt: null,
          ...makeCreateAudit(auth),
        },
        select: { publicId: true, publicNumber: true },
      })
      if (body.start) {
        const eng = await ensureEngineRunning()
        void eng.tick()
      }
      return { job: { id: job.publicId, publicId: job.publicId, publicNumber: job.publicNumber } }
    },
  },
  {
    name: "job_delete",
    description: "Delete job",
    inputSchema: idSchema,
    riskLevel: "destructive",
    execute: async (ctx, input) => {
      const result = await deleteJobByPublicId({ viewerAuth: mustViewerAuth(ctx), jobId: input.id })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true }
    },
  },
  {
    name: "job_cancel",
    description: "Cancel job",
    inputSchema: idSchema.extend({ reason: z.string().optional() }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const result = await cancelJobByPublicId({
        viewerAuth: mustViewerAuth(ctx),
        jobId: input.id,
        reason: input.reason ?? null,
      })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true }
    },
  },
  {
    name: "job_resume",
    description: "Resume paused job",
    inputSchema: idSchema,
    riskLevel: "write",
    execute: async (ctx, input) => {
      const result = await resumeJobByPublicId({
        auth: mustAuth(ctx),
        viewerAuth: mustViewerAuth(ctx),
        jobId: input.id,
      })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true }
    },
  },
  {
    name: "job_attempt_list",
    description: "List job attempts",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const jobPublicId = String(input.id).trim().toLowerCase()
      const job = await prisma.jobRun.findFirst({
        where: getJobRunFindFirstWhereByPublicId(mustViewerAuth(ctx), jobPublicId),
        select: { id: true },
      })
      if (!job) throw new ToolExecutionError("NOT_FOUND")
      const attempts = await prisma.jobRunAttempt.findMany({
        where: { jobRunId: job.id },
        orderBy: [{ attemptNo: "asc" }],
        select: {
          attemptNo: true,
          status: true,
          run: { select: { publicId: true, publicNumber: true, status: true } },
          errorCode: true,
          errorMessage: true,
          errorMetaJson: true,
          errorAt: true,
          startedAt: true,
          finishedAt: true,
        },
      })
      return {
        attempts: attempts.map((a) => ({
          id: `attempt:${a.attemptNo}`,
          jobRunId: jobPublicId,
          attemptNo: a.attemptNo,
          status: a.status,
          runId: a.run?.publicId ?? null,
          run: a.run
            ? { id: a.run.publicId, publicId: a.run.publicId, publicNumber: a.run.publicNumber, status: a.run.status }
            : null,
          errorCode: a.errorCode ?? null,
          errorMessage: a.errorMessage ?? null,
          errorMetaJson: a.errorMetaJson ?? null,
          errorAt: a.errorAt ?? null,
          startedAt: a.startedAt ?? null,
          finishedAt: a.finishedAt ?? null,
        })),
      }
    },
  },
  {
    name: "job_input_file_list",
    description: "List job input files",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const job = await prisma.jobRun.findFirst({
        where: getJobRunFindFirstWhereByPublicId(mustViewerAuth(ctx), String(input.id).trim().toLowerCase()),
        select: {
          publicId: true,
          inputFiles: {
            orderBy: [{ createdAt: "asc" }],
            select: {
              id: true,
              name: true,
              source: true,
              status: true,
              url: true,
              error: true,
              sha256: true,
              sizeBytes: true,
              mime: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      })
      if (!job) throw new ToolExecutionError("NOT_FOUND")
      return {
        jobId: job.publicId,
        inputFiles: job.inputFiles.map((f) => ({
          id: f.id,
          name: f.name,
          source: f.source,
          status: f.status,
          url: f.url ?? null,
          error: f.error ?? null,
          sha256: f.sha256 ?? null,
          sizeBytes: typeof f.sizeBytes === "number" ? f.sizeBytes : null,
          mime: f.mime ?? null,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        })),
      }
    },
  },

  // schedules
  {
    name: "schedule_list",
    description: "List schedules (summary). Use schedule_get for full details.",
    inputSchema: listSchema.extend({
      status: z.enum(["ENABLED", "DISABLED"]).optional(),
      sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const result = await listSchedules({ viewerAuth: mustViewerAuth(ctx), query: input })
      return {
        schedules: result.schedules.map((s) => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          workflowId: s.workflowId,
          workflowName: s.workflowName,
          kind: s.kind,
          cron: s.cron,
          timezone: s.timezone,
          ...(s.intervalMs ? { intervalMs: s.intervalMs } : {}),
          nextRunAt: s.nextRunAt,
          lastRunAt: s.lastRunAt,
        })),
        ...slimPage(result.total, input.page, input.pageSize),
      }
    },
  },
  {
    name: "schedule_get",
    description: "Get schedule",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const schedule = await getScheduleByPublicId({ viewerAuth: mustViewerAuth(ctx), scheduleId: input.id })
      if (!schedule) throw new ToolExecutionError("NOT_FOUND")
      return { schedule }
    },
  },
  {
    name: "schedule_create",
    description: "Create a schedule to run a workflow periodically.",
    inputSchema: z.object({
      workflowId: z.string().min(1).describe("Public ID of the workflow, e.g. wf-1"),
      name: z.string().trim().max(200).optional().describe("Schedule name"),
      kind: z.enum(["CRON", "INTERVAL"]).default("CRON"),
      cron: z.string().trim().max(200).optional().describe("Cron expression, e.g. '0 8 * * *' for daily at 8am"),
      timezone: z.string().trim().max(64).optional().default("UTC"),
      intervalMs: z.number().int().min(1000).optional().describe("Interval in milliseconds (for INTERVAL kind)"),
      enabled: z.boolean().optional().default(true),
      inputJson: z.unknown().optional().default({}).describe("Input parameters for the workflow"),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const res = await createSchedule({ auth: mustAuth(ctx), viewerAuth: mustViewerAuth(ctx), body: input as any })
      if (!res.ok) throw new ToolExecutionError(res.code, res.code, { issues: res.issues, meta: res.meta })
      return { schedule: { id: res.schedulePublicId, publicId: res.schedulePublicId } }
    },
  },
  {
    name: "schedule_patch",
    description: "Partially update a schedule (name, cron, enabled, etc.).",
    inputSchema: z.object({
      id: z.string().min(1).describe("Public ID of the schedule, e.g. sch-1"),
      name: z.string().trim().max(200).optional(),
      enabled: z.boolean().optional(),
      cron: z.string().trim().max(200).optional(),
      timezone: z.string().trim().max(64).optional(),
      intervalMs: z.number().int().min(1000).optional(),
      inputJson: z.unknown().optional(),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const { id, ...rest } = input as Record<string, unknown>
      const res = await patchScheduleByPublicId({
        auth: mustAuth(ctx),
        viewerAuth: mustViewerAuth(ctx),
        scheduleId: String(id),
        body: rest as any,
      })
      if (!res.ok) throw new ToolExecutionError(res.code, res.code, { issues: res.issues, meta: res.meta })
      return { schedule: res.schedule }
    },
  },
  {
    name: "schedule_delete",
    description: "Delete schedule",
    inputSchema: idSchema,
    riskLevel: "destructive",
    execute: async (ctx, input) => {
      const result = await deleteScheduleByPublicId({ viewerAuth: mustViewerAuth(ctx), scheduleId: input.id })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true }
    },
  },
  {
    name: "schedule_preview",
    description: "Preview schedule",
    inputSchema: idSchema.extend({ limit: z.coerce.number().int().min(1).max(20).optional().default(5) }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const preview = await previewScheduleByPublicId({
        auth: mustAuth(ctx),
        scheduleId: input.id,
        query: { limit: input.limit },
      })
      if (!preview) throw new ToolExecutionError("NOT_FOUND")
      return preview
    },
  },
  {
    name: "schedule_run_now",
    description: "Run schedule now",
    inputSchema: idSchema,
    riskLevel: "write",
    execute: async (ctx, input) => {
      const res = await runScheduleNowByPublicId({
        auth: mustAuth(ctx),
        viewerAuth: mustViewerAuth(ctx),
        scheduleId: input.id,
      })
      if (!res) throw new ToolExecutionError("NOT_FOUND")
      return { ok: true, jobId: res.jobPublicId }
    },
  },
  {
    name: "schedule_job_list",
    description: "List jobs under schedule (summary). Use job_get for full details.",
    inputSchema: listSchema.extend({
      id: z.string().trim().min(1),
      status: z.enum(["QUEUED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
      sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) =>
      slimJobListResult(
        await listJobs({
          viewerAuth: mustViewerAuth(ctx),
          query: {
            q: input.q,
            page: input.page,
            pageSize: input.pageSize,
            sort: input.sort,
            status: input.status,
            scheduleId: input.id,
          },
        }),
      ),
  },

  // batches
  {
    name: "batch_list",
    description: "List batches (summary). Use batch_get for full details.",
    inputSchema: listSchema.extend({
      status: z.enum(["CREATED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
      sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const result = await listBatches({ viewerAuth: mustViewerAuth(ctx), query: input })
      return {
        batches: result.batches.map((b) => ({
          id: b.id,
          name: b.name,
          status: b.status,
          workflowId: b.workflowId,
          workflowName: b.workflowName,
          concurrencyLimit: b.concurrencyLimit,
          failFast: b.failFast,
          jobsTotal: b.jobsTotal,
          jobsByStatus: b.jobsByStatus,
          startedAt: b.startedAt,
          finishedAt: b.finishedAt,
        })),
        ...slimPage(result.total, input.page, input.pageSize),
      }
    },
  },
  {
    name: "batch_get",
    description: "Get batch",
    inputSchema: idSchema,
    riskLevel: "read",
    execute: async (ctx, input) => {
      const batch = await getBatchByPublicId({ viewerAuth: mustViewerAuth(ctx), batchId: input.id })
      if (!batch) throw new ToolExecutionError("NOT_FOUND")
      return { batch }
    },
  },
  {
    name: "batch_create",
    description: "Create a batch to run a workflow over multiple inputs in parallel.",
    inputSchema: z.object({
      workflowId: z.string().min(1).describe("Public ID of the workflow, e.g. wf-1"),
      name: z.string().trim().max(200).optional().describe("Batch name"),
      pinnedWorkflowVersionNumber: z.number().int().min(1).optional().describe("Pin to a specific workflow version"),
      concurrencyLimit: z.number().int().min(1).max(10_000).optional().describe("Max concurrent jobs"),
      failFast: z.boolean().optional().default(false).describe("Stop on first failure"),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const res = await createBatch({ auth: mustAuth(ctx), viewerAuth: mustViewerAuth(ctx), body: input as any })
      if (!res.ok) throw new ToolExecutionError(res.code, res.code, { issues: res.issues, meta: res.meta })
      return { batch: { id: res.batchPublicId, publicId: res.batchPublicId, publicNumber: res.batchPublicNumber } }
    },
  },
  {
    name: "batch_patch",
    description: "Partially update a batch (name, concurrency, failFast, etc.).",
    inputSchema: z.object({
      id: z.string().min(1).describe("Public ID of the batch, e.g. bat-1"),
      name: z.string().trim().max(200).optional(),
      concurrencyLimit: z.number().int().min(1).max(10_000).optional(),
      failFast: z.boolean().optional(),
      maxFailures: z.number().int().min(1).max(10_000).optional(),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const { id, ...rest } = input as Record<string, unknown>
      const res = await patchBatchByPublicId({
        auth: mustAuth(ctx),
        viewerAuth: mustViewerAuth(ctx),
        batchId: String(id),
        body: rest as any,
      })
      if (!res.ok) throw new ToolExecutionError(res.code, res.code, { issues: res.issues, meta: res.meta })
      return { batch: res.batch }
    },
  },
  {
    name: "batch_delete",
    description: "Delete batch",
    inputSchema: idSchema,
    riskLevel: "destructive",
    execute: async (ctx, input) => {
      const result = await deleteBatchByPublicId({ viewerAuth: mustViewerAuth(ctx), batchId: input.id })
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true }
    },
  },
  {
    name: "batch_pause",
    description: "Pause batch",
    inputSchema: idSchema,
    riskLevel: "write",
    execute: async (ctx, input) => {
      const result = await pauseBatch(mustAuth(ctx), input.id)
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true, paused: result.paused }
    },
  },
  {
    name: "batch_resume",
    description: "Resume batch",
    inputSchema: idSchema,
    riskLevel: "write",
    execute: async (ctx, input) => {
      const result = await resumeBatch(mustAuth(ctx), input.id)
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true, resumed: result.resumed }
    },
  },
  {
    name: "batch_cancel",
    description: "Cancel batch",
    inputSchema: idSchema,
    riskLevel: "write",
    execute: async (ctx, input) => {
      const result = await cancelBatch(mustAuth(ctx), input.id)
      if (!result.ok) throw new ToolExecutionError(result.code)
      return { ok: true, canceledImmediate: result.canceledImmediate, cancelRequested: result.cancelRequested }
    },
  },
  {
    name: "batch_fanout",
    description: "Fanout batch jobs",
    inputSchema: idSchema.extend({
      seedJson: z.unknown(),
      kind: z.enum(["auto"]).optional().default("auto"),
      maxItems: z.coerce.number().int().min(1).max(5000).optional().default(2000),
      start: z.boolean().optional().default(true),
      shardCount: z.coerce.number().int().min(1).max(10_000).optional().default(1),
      shardIndex: z.coerce.number().int().min(0).max(9_999).optional().default(0),
      urlFiles: z
        .array(z.object({ url: z.string().min(1), name: z.string().optional(), id: z.string().optional() }))
        .optional(),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const { id, ...rest } = input
      const res = await startBatchFanout({ auth: mustAuth(ctx), batchId: id, body: rest as any })
      if (!res.ok) throw new ToolExecutionError(res.code, res.code, { issues: res.issues, meta: res.meta })
      return res.body
    },
  },
  {
    name: "batch_job_create",
    description: "Create batch job",
    inputSchema: z.object({
      id: z.string().min(1),
      items: z.array(z.unknown()).min(1).max(5000),
      start: z.boolean().optional().default(true),
    }),
    riskLevel: "write",
    execute: async (ctx, input) => {
      const res = await createBatchJobs({
        auth: mustAuth(ctx),
        batchId: input.id,
        body: { items: input.items, start: input.start ?? true },
      })
      if (!res.ok) throw new ToolExecutionError(res.code)
      return res.body
    },
  },
  {
    name: "batch_job_list",
    description: "List jobs under batch (summary). Use job_get for full details.",
    inputSchema: listSchema.extend({
      id: z.string().trim().min(1),
      status: z.enum(["QUEUED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
      sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) =>
      slimJobListResult(
        await listJobs({
          viewerAuth: mustViewerAuth(ctx),
          query: {
            q: input.q,
            page: input.page,
            pageSize: input.pageSize,
            sort: input.sort,
            status: input.status,
            batchId: input.id,
          },
        }),
      ),
  },

  // operations
  {
    name: "operation_list",
    description: "List operations (summary). Use operation_get for full details.",
    inputSchema: listSchema.extend({
      status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]).optional(),
      action: z.string().trim().min(1).max(100).optional(),
      targetId: z.string().trim().min(1).max(200).optional(),
      targetType: z.string().trim().min(1).max(50).optional(),
      sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) =>
      slimOperationListResult(await listOperations({ viewerAuth: mustViewerAuth(ctx), query: input })),
  },
  {
    name: "operation_get",
    description: "Get operation",
    inputSchema: idSchema.extend({ expandTarget: z.boolean().optional() }),
    riskLevel: "read",
    execute: async (ctx, input) => {
      const result = await getOperationByPublicId({
        viewerAuth: mustViewerAuth(ctx),
        operationId: input.id,
        expandTarget: input.expandTarget ?? false,
      })
      if (!result) throw new ToolExecutionError("OPERATION_NOT_FOUND")
      return result
    },
  },
  {
    name: "operation_maintenance_get",
    description: "Get operation maintenance info",
    inputSchema: z.object({ run: z.boolean().optional() }),
    riskLevel: "read",
    internalOnly: true,
    execute: async (_ctx, input) => {
      if (input.run) await maybeCleanupOperations()
      return { ok: true, config: getCleanupConfig(), last: getLastCleanupResult() }
    },
  },
  {
    name: "operation_list_by_target",
    description: "List operations by target (summary). Use operation_get for full details.",
    inputSchema: z.object({
      targetType: z.string().trim().min(1),
      targetId: z.string().trim().min(1),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(20),
      sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
    }),
    riskLevel: "read",
    execute: async (ctx, input) =>
      slimOperationListResult(
        await listOperations({
          viewerAuth: mustViewerAuth(ctx),
          query: {
            targetType: input.targetType,
            targetId: input.targetId,
            page: input.page,
            pageSize: input.pageSize,
            sort: input.sort,
          },
        }),
      ),
  },
]

const registry = new Map<string, RegisteredTool>()
for (const t of tools) registry.set(t.name, t)

export function listRegisteredTools(opts?: { includeInternal?: boolean }) {
  return tools.filter((t) => (opts?.includeInternal ? true : !t.internalOnly))
}

export function getRegisteredTool(name: string) {
  return registry.get(name)
}

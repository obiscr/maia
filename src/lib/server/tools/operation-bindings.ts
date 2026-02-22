import "server-only"

import type { OperationAction, OperationTargetType } from "@/lib/server/operations/operations"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

export type ToolOperationBinding = {
  action: OperationAction
  scope: string
  targetType: OperationTargetType
  targetId: (input: unknown) => string | null
}

const readStringField = (input: unknown, key: string): string | null => {
  if (!isPlainObject(input)) return null
  const v = (input as Record<string, unknown>)[key]
  const s = typeof v === "string" ? v.trim() : ""
  return s.length ? s : null
}

export const TOOL_OPERATION_BINDINGS: Record<string, ToolOperationBinding> = {
  "workflow.create": {
    action: "WORKFLOW_CREATE",
    scope: "workflows:create",
    targetType: "workflow",
    targetId: (_input) => null,
  },
  "workflow.deps.install": {
    action: "WORKFLOW_DEPS_INSTALL",
    scope: "workflows:deps:install",
    targetType: "workflow",
    targetId: (input) => readStringField(input, "id"),
  },
  "job.create": {
    action: "JOB_CREATE",
    scope: "jobs:create",
    targetType: "job",
    targetId: (_input) => null,
  },
  "job.cancel": {
    action: "JOB_CANCEL",
    scope: "jobs:cancel",
    targetType: "job",
    targetId: (input) => readStringField(input, "id"),
  },
  "job.resume": {
    action: "JOB_RESUME",
    scope: "jobs:resume",
    targetType: "job",
    targetId: (input) => readStringField(input, "id"),
  },
  "schedule.create": {
    action: "SCHEDULE_CREATE",
    scope: "schedules:create",
    targetType: "schedule",
    targetId: (_input) => null,
  },
  "schedule.run_now": {
    action: "SCHEDULE_RUN_NOW",
    scope: "schedules:run-now",
    targetType: "schedule",
    targetId: (input) => readStringField(input, "id"),
  },
  "batch.create": {
    action: "BATCH_CREATE",
    scope: "batches:create",
    targetType: "batch",
    targetId: (_input) => null,
  },
  "batch.fanout": {
    action: "BATCH_FANOUT",
    scope: "batches:fanout",
    targetType: "batch",
    targetId: (input) => readStringField(input, "id"),
  },
  "batch.job.create": {
    action: "BATCH_JOBS_CREATE",
    scope: "batches:jobs:create",
    targetType: "batch",
    targetId: (input) => readStringField(input, "id"),
  },
  "batch.pause": {
    action: "BATCH_PAUSE",
    scope: "batches:pause",
    targetType: "batch",
    targetId: (input) => readStringField(input, "id"),
  },
  "batch.resume": {
    action: "BATCH_RESUME",
    scope: "batches:resume",
    targetType: "batch",
    targetId: (input) => readStringField(input, "id"),
  },
  "batch.cancel": {
    action: "BATCH_CANCEL",
    scope: "batches:cancel",
    targetType: "batch",
    targetId: (input) => readStringField(input, "id"),
  },
  "run.cancel": {
    action: "RUN_CANCEL",
    scope: "runs:cancel",
    targetType: "run",
    targetId: (input) => readStringField(input, "id"),
  },
  "run.force_stop": {
    action: "RUN_FORCE_STOP",
    scope: "runs:force-stop",
    targetType: "run",
    targetId: (input) => readStringField(input, "id"),
  },
  "run.step.retry": {
    action: "RUN_STEP_RETRY",
    scope: "runs:steps:retry",
    targetType: "runStep",
    targetId: (input) => {
      const runId = readStringField(input, "id")
      const stepKey = readStringField(input, "stepKey")
      return runId && stepKey ? `${runId}:${stepKey}` : runId
    },
  },
  "run.step.rerun": {
    action: "RUN_STEP_RERUN",
    scope: "runs:steps:rerun",
    targetType: "runStep",
    targetId: (input) => {
      const runId = readStringField(input, "id")
      const stepKey = readStringField(input, "stepKey")
      return runId && stepKey ? `${runId}:${stepKey}` : runId
    },
  },
  "run.step.restart": {
    action: "RUN_STEP_RESTART",
    scope: "runs:steps:restart",
    targetType: "runStep",
    targetId: (input) => {
      const runId = readStringField(input, "id")
      const stepKey = readStringField(input, "stepKey")
      return runId && stepKey ? `${runId}:${stepKey}` : runId
    },
  },
}

export function operationSourceFromToolContext(source: string): "agent" | "mcp" | null {
  const s = String(source || "")
    .trim()
    .toLowerCase()
  if (!s) return null
  if (s.startsWith("agent")) return "agent"
  if (s.startsWith("mcp")) return "mcp"
  return null
}

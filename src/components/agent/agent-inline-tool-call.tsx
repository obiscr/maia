"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, CheckCircle2, Circle, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { useI18n } from "@/components/i18n-provider"
import { getToolName } from "ai"
import { sdkToCanonicalToolName, type ToolPart } from "@/lib/shared/agent/tool-parts"
import { JsonViewer } from "@/components/common/json-viewer"
import { GradientCircleArrowRightIcon } from "@/components/icons/GradientCircleArrowRightIcon"

function rawToI18nKey(raw: string): string {
  return sdkToCanonicalToolName(raw)
}

const fallbackStatusKey = {
  todo: "toolCalls.fallback.todo",
  running: "toolCalls.fallback.running",
  done: "toolCalls.fallback.done",
  failed: "toolCalls.fallback.failed",
} as const satisfies Record<"todo" | "running" | "done" | "failed", string>

function resolveFallbackStatusText(
  t: (k: string, v?: Record<string, string | number>) => string,
  state: "todo" | "running" | "done" | "failed",
): string {
  return (
    tryT(t, `toolCalls.status.${state}`) ||
    tryT(t, fallbackStatusKey[state]) ||
    (state === "todo" ? "Pending" : state === "running" ? "Running…" : state === "done" ? "Done" : "Failed")
  )
}

function resolveI18n(
  t: (k: string, v?: Record<string, string | number>) => string,
  toolName: string,
  state: "todo" | "running" | "done" | "failed",
  vars?: Record<string, string | number>,
): { label: string; status: string } {
  const normalized = rawToI18nKey(toolName)
  const fallbackStatus = resolveFallbackStatusText(t, state)

  const directLabel = tryT(t, `toolCalls.${toolName}.label`)
  if (directLabel) {
    let statusKey: string | null = null
    if (state === "done" && vars) {
      statusKey =
        tryT(t, `toolCalls.${toolName}.doneWithCount`, vars) ?? tryT(t, `toolCalls.${toolName}.doneWithName`, vars)
    } else if (state === "running" && vars) {
      statusKey = tryT(t, `toolCalls.${toolName}.runningWithName`, vars)
    }
    return {
      label: directLabel,
      status:
        statusKey ||
        tryT(t, `toolCalls.${toolName}.${state}`) ||
        tryT(t, `toolCalls.status.${state}`) ||
        fallbackStatus,
    }
  }

  const parts = normalized.split(".")
  if (parts.length >= 2) {
    const [domain, ...rest] = parts
    const action = rest.join("_")
    const domainLabel = tryT(t, `toolCalls.${domain}.${action}.label`)
    if (domainLabel) {
      return {
        label: domainLabel,
        status:
          tryT(t, `toolCalls.${domain}.${action}.${state}`) || tryT(t, `toolCalls.status.${state}`) || fallbackStatus,
      }
    }
  }

  return {
    label: normalized,
    status: tryT(t, `toolCalls.status.${state}`) || fallbackStatus,
  }
}

function tryT(
  t: (k: string, v?: Record<string, string | number>) => string,
  i18nKey: string,
  vars?: Record<string, string | number>,
): string | null {
  const result = t(i18nKey, vars)
  return result === i18nKey ? null : result
}

type ToolCategory =
  | "orchestrator_plan"
  | "orchestrator_panel"
  | "orchestrator_finalize"
  | "orchestrator_persist"
  | "read"
  | "write"
  | "generic"

function categorize(toolName: string): ToolCategory {
  if (toolName === "plan_dashboard") return "orchestrator_plan"
  if (toolName === "define_panel") return "orchestrator_panel"
  if (toolName === "validate_dashboard") return "orchestrator_finalize"
  if (toolName === "create_dashboard" || toolName === "update_dashboard") return "orchestrator_persist"
  if (toolName === "load_dashboard") return "read"

  const n = rawToI18nKey(toolName)
  if (
    n.includes(".list") ||
    n.includes(".get") ||
    n.includes(".export") ||
    n.includes(".preview") ||
    n.includes(".download") ||
    n.includes(".definition") ||
    n.includes(".input") ||
    n.includes(".output") ||
    n.includes(".artifact") ||
    n.includes(".log") ||
    n.includes(".meta")
  )
    return "read"
  if (
    n.includes(".create") ||
    n.includes(".update") ||
    n.includes(".patch") ||
    n.includes(".delete") ||
    n.includes(".cancel") ||
    n.includes(".resume") ||
    n.includes(".pause") ||
    n.includes(".stop") ||
    n.includes(".retry") ||
    n.includes(".rerun") ||
    n.includes(".restart") ||
    n.includes(".install") ||
    n.includes(".restore") ||
    n.includes(".fanout") ||
    n.includes(".run_now") ||
    n.includes(".snapshot")
  )
    return "write"
  return "generic"
}

function shouldShowDetails(category: ToolCategory, state: string): boolean {
  if (category === "orchestrator_plan") return false
  if (category === "orchestrator_panel") return state === "output-error"
  if (category === "orchestrator_finalize") return state === "output-error"
  if (category === "orchestrator_persist") return true
  if (category === "write" && state === "output-available") return false
  return true
}

function isTrivialOutput(output: Record<string, unknown> | null | undefined): boolean {
  return output != null && output.ok === true && Object.keys(output).length === 1
}

// ---------------------------------------------------------------------------
// Dashboard: Plan card — shows the planned panels list
// ---------------------------------------------------------------------------

function PlanCard({ part }: { part: ToolPart }) {
  const inp = part.input as Record<string, unknown> | undefined
  const title = typeof inp?.title === "string" ? inp.title : null
  const rawPanels = Array.isArray(inp?.panels) ? (inp.panels as unknown[]) : []
  if (!rawPanels.length) return null

  return (
    <div className="mt-1.5 space-y-1 p-2">
      {title ? <div className="text-xs font-medium text-foreground">{title}</div> : null}
      <ol className="list-decimal list-inside space-y-0.5">
        {rawPanels.map((s, i) => {
          const text =
            typeof s === "string"
              ? s
              : s && typeof s === "object" && "title" in s && typeof (s as Record<string, unknown>).title === "string"
                ? `${(s as Record<string, unknown>).title} — ${(s as Record<string, unknown>).chartType ?? ""}`
                : String(s)
          return (
            <li key={i} className="text-xs text-muted-foreground leading-relaxed">
              {text}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard: Panel card — shows define_panel input summary
// ---------------------------------------------------------------------------

function PanelCard({ part }: { part: ToolPart }) {
  const inp = part.input as Record<string, unknown> | undefined
  if (!inp) return null

  const title = typeof inp.title === "string" ? inp.title : ""
  const panelKey = typeof inp.panelKey === "string" ? inp.panelKey : ""
  const chartType = typeof inp.chartType === "string" ? inp.chartType : null
  const dataLength = Array.isArray(inp.data) ? inp.data.length : 0

  return (
    <div className="p-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground">{title || panelKey}</span>
        {panelKey && title ? <span className="text-[10px] text-muted-foreground font-mono">{panelKey}</span> : null}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        {chartType ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{chartType}</span> : null}
        {dataLength > 0 ? <span>{dataLength} rows</span> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status icon — memoized to avoid animation glitches during parent re-renders.
// ---------------------------------------------------------------------------

const ToolStatusIcon = React.memo(function ToolStatusIcon(props: {
  state: "todo" | "in_progress" | "done" | "failed"
}) {
  if (props.state === "in_progress") {
    return <GradientCircleArrowRightIcon className="h-4 w-4 shrink-0 animate-in fade-in-0 duration-200" />
  }
  if (props.state === "failed") {
    return <XCircle className="h-4 w-4 shrink-0 text-destructive animate-in fade-in-0 duration-200" />
  }
  if (props.state === "done") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground animate-in fade-in-0 duration-200" />
  }
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
})

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentInlineToolCall(props: { part: ToolPart; plannedName?: string; isStreaming?: boolean }) {
  const { t } = useI18n()
  const part = props.part
  const rawName = getToolName(part as Parameters<typeof getToolName>[0])
  const [open, setOpen] = React.useState(
    () =>
      part.state === "output-available" ||
      part.state === "output-error" ||
      part.state === "output-denied" ||
      part.state === "approval-requested" ||
      part.state === "approval-responded",
  )
  const hasUserToggledRef = React.useRef(false)
  const prevDoneRef = React.useRef(part.state === "output-available")
  const prevErrorRef = React.useRef(part.state === "output-error")

  const isDone = part.state === "output-available"
  const isApprovalRequested = part.state === "approval-requested"
  const isApprovalResponded = part.state === "approval-responded"
  const isOutputDenied = part.state === "output-denied"
  const outputRecord =
    isDone && typeof part.output === "object" && part.output != null ? (part.output as Record<string, unknown>) : null
  const okFlag = typeof outputRecord?.ok === "boolean" ? (outputRecord.ok as boolean) : null
  // Some tools return ok:false while still being "output-available" — treat that as failed.
  const isError = part.state === "output-error" || isOutputDenied || (isDone && okFlag === false)

  const category = categorize(rawName)
  const stateKey = isError ? "failed" : isDone ? "done" : "running"

  const vars: Record<string, string | number> = {}
  if (category === "orchestrator_plan" && isDone) {
    const inp = part.input as Record<string, unknown> | undefined
    const panels = Array.isArray(inp?.panels) ? inp.panels : []
    if (panels.length) vars.count = panels.length
  }
  if (category === "orchestrator_panel") {
    const inp = part.input as Record<string, unknown> | undefined
    const name = typeof inp?.title === "string" ? inp.title : props.plannedName
    if (name) vars.name = name
  }

  const i18n = resolveI18n(t, rawName, stateKey, Object.keys(vars).length ? vars : undefined)
  const displayLabel = `${t("toolCalls.title")}: ${i18n.label}`

  const showDetailSection =
    shouldShowDetails(category, isError ? "output-error" : part.state) && !isTrivialOutput(outputRecord)
  const hasOutput = isDone && part.output != null
  const hasError = isError && (part.errorText != null || part.output != null)
  const hasInput = part.input != null
  const hasJsonToShow = showDetailSection && (hasOutput || hasError || hasInput)
  const errorPayload = React.useMemo(() => {
    if (!isError) return null
    // Keep failure card complete for debugging:
    // show input + error + output together instead of dropping output when errorText exists.
    const payload: Record<string, unknown> = {}
    if (part.input != null) payload.input = part.input
    if (part.errorText != null) payload.errorText = part.errorText
    if (part.output != null) payload.output = part.output
    return Object.keys(payload).length ? payload : null
  }, [isError, part.errorText, part.input, part.output])

  const hasOrchestratorBody =
    (category === "orchestrator_plan" && (isDone || part.state === "input-available")) ||
    (category === "orchestrator_panel" && (isDone || part.state === "input-available"))

  const hasExpandable = hasJsonToShow || hasOrchestratorBody
  const detailPayload = React.useMemo(() => {
    if (!hasJsonToShow) return null
    if (isError) return errorPayload
    if (hasOutput) return part.output
    if (hasInput || isApprovalRequested || isApprovalResponded) {
      return { input: part.input, state: part.state }
    }
    return null
  }, [
    hasJsonToShow,
    isError,
    errorPayload,
    hasOutput,
    hasInput,
    isApprovalRequested,
    isApprovalResponded,
    part.input,
    part.output,
    part.state,
  ])

  React.useEffect(() => {
    const wasDone = prevDoneRef.current
    prevDoneRef.current = isDone
    const wasError = prevErrorRef.current
    prevErrorRef.current = isError

    if (hasUserToggledRef.current) return
    if (!wasDone && isDone && hasExpandable) setOpen(true)
    if (!wasError && isError && hasExpandable) setOpen(true)
  }, [isDone, isError, hasExpandable, part.state])

  const iconState = isError ? ("failed" as const) : isDone ? ("done" as const) : ("in_progress" as const)

  const statusTextClass =
    iconState === "in_progress"
      ? "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-500 bg-clip-text font-medium text-transparent"
      : iconState === "failed"
        ? "text-destructive font-medium"
        : "text-muted-foreground"

  return (
    <div className="my-1.5 rounded-md border bg-muted/20 overflow-hidden">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40",
          hasExpandable ? "cursor-pointer" : "cursor-default",
        )}
        onClick={() => {
          if (!hasExpandable) return
          hasUserToggledRef.current = true
          setOpen((v) => !v)
        }}
        disabled={!hasExpandable}
      >
        <ToolStatusIcon state={iconState} />

        <span className={cn("min-w-0 flex-1 truncate text-xs", statusTextClass)}>{i18n.status}</span>

        <span className="shrink-0 max-w-[45%] truncate text-right text-[10px] text-muted-foreground">
          {displayLabel}
        </span>

        {hasExpandable ? (
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : null}
      </button>

      {open && hasExpandable ? (
        <div className="border-t divide-y bg-background">
          {category === "orchestrator_plan" ? <PlanCard part={part} /> : null}
          {category === "orchestrator_panel" ? <PanelCard part={part} /> : null}

          {hasJsonToShow ? (
            <div className="w-0 min-w-full">
              {detailPayload != null ? (
                <JsonViewer value={detailPayload} className="max-h-64" defaultWrap={false} preClassName="p-2" />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

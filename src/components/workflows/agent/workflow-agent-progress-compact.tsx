import * as React from "react"
import { CheckCircle2, ChevronDown, ChevronUp, Circle, ListTodo } from "lucide-react"

import { cn } from "@/lib/utils"
import { GradientLoaderIcon } from "@/components/icons/GradientLoaderIcon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export type WorkflowAgentProgressStatus = "todo" | "in_progress" | "done"
export type WorkflowAgentProgressMode = "planning" | "list"

function StatusMark(props: { status: WorkflowAgentProgressStatus; gradient?: boolean }) {
  if (props.status === "done") {
    return <CheckCircle2 className="h-[18px] w-[18px] text-muted-foreground" />
  }
  if (props.status === "in_progress") {
    return props.gradient ? (
      <GradientLoaderIcon className="h-4 w-4 animate-spin" />
    ) : (
      <GradientLoaderIcon className="h-4 w-4 animate-spin" />
    )
  }
  return <Circle className="h-4 w-4 text-muted-foreground" />
}

function Row(props: {
  label: string
  status: WorkflowAgentProgressStatus
  active?: boolean
  dim?: boolean
  gradientSpinner?: boolean
}) {
  return (
    <div className={cn("flex items-start gap-2 py-1.5", props.dim && "opacity-55", props.active && "text-foreground")}>
      <div className="mt-0.5 shrink-0">
        <StatusMark status={props.status} gradient={props.gradientSpinner} />
      </div>
      <div
        className={cn(
          "min-w-0 text-sm leading-5",
          props.active &&
            "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-500 bg-clip-text font-medium text-transparent",
          props.dim && "text-muted-foreground",
        )}
      >
        {props.label}
      </div>
    </div>
  )
}

export function WorkflowAgentProgressCompact(props: {
  title: string
  generatingPlanText: string
  generatingStepText?: string
  completedCountText?: string
  plan?: { title?: string | null; steps?: string[] } | null
  draftStepsCount?: number
  done?: boolean
  mode?: WorkflowAgentProgressMode
  className?: string
}) {
  const planSteps = Array.isArray(props.plan?.steps) ? (props.plan?.steps as string[]) : []
  const [collapsed, setCollapsed] = React.useState(false)

  // Phase:
  // - planning: no plan steps yet (show only the "Generating plan…" bar)
  // - plan_ready / executing: plan steps exist (show todo list; active item moves as draft steps stream in)
  const isDone = !!props.done
  const mode: WorkflowAgentProgressMode = props.mode ?? (planSteps.length === 0 ? "planning" : "list")
  const isPlanning = mode === "planning" && !isDone
  const draftCount = Math.max(0, Number(props.draftStepsCount ?? 0) || 0)
  const computedAllDone = planSteps.length > 0 && draftCount >= planSteps.length
  const isDoneLike = isDone || computedAllDone
  // Correct semantics:
  // - While executing, the ACTIVE row is the NEXT step being generated (spinner).
  // - A step becomes DONE once its draft node has been emitted (draft_step arrived).
  // So: doneCount = draftCount, activeIdx = draftCount (clamped), and when all steps are emitted, no active spinner.
  const doneCount = isDone ? planSteps.length : Math.min(draftCount, planSteps.length)
  const activeIdx = isDoneLike ? null : draftCount < planSteps.length ? draftCount : null

  const formatTemplate = React.useCallback((tpl: string | undefined, vars: Record<string, string | number>) => {
    if (!tpl) return ""
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""))
  }, [])

  const getActiveStepLabel = React.useCallback(() => {
    if (activeIdx == null) return ""
    const raw = String(planSteps[activeIdx] ?? "").trim()
    if (!raw) return `Step ${activeIdx + 1}`
    // If user-provided labels already include numbering (e.g. "9. ..."), keep it as-is.
    if (/^\s*\d+\.\s+/.test(raw)) return raw
    return `${activeIdx + 1}. ${raw}`
  }, [activeIdx, planSteps])

  const collapsedHeadline = React.useMemo(() => {
    if (isPlanning) return props.generatingPlanText
    if (isDoneLike) return ""
    const step = getActiveStepLabel()
    return formatTemplate(props.generatingStepText, { step }) || (step ? `Generating: ${step}` : "")
  }, [formatTemplate, getActiveStepLabel, isDoneLike, isPlanning, props.generatingPlanText, props.generatingStepText])

  const completedBadgeText = formatTemplate(props.completedCountText, { count: doneCount }) || `${doneCount} completed`

  return (
    <div
      className={cn(
        // Prevent long single-line text from expanding the ScrollArea's internal table width.
        "w-full max-w-full overflow-hidden rounded-lg border bg-background px-3 py-2 shadow-sm",
        props.className,
      )}
    >
      {isPlanning ? (
        <div className="flex items-center gap-2">
          <GradientLoaderIcon className="h-4 w-4 shrink-0 animate-spin" />
          <span className="bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-500 bg-clip-text text-sm font-medium text-transparent">
            {props.generatingPlanText}
          </span>
        </div>
      ) : (
        <>
          <div className={cn("flex items-center gap-2", !collapsed && "pb-1")}>
            {/* Left: content (can shrink/truncate). Right: actions (badge + toggle, never clipped). */}
            <div className="min-w-0 flex-1 flex items-center gap-2">
              {collapsed && !isDoneLike ? (
                <>
                  <GradientLoaderIcon className="h-4 w-4 shrink-0 animate-spin" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="min-w-0 flex-1 line-clamp-1 bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-500 bg-clip-text text-sm font-medium text-transparent">
                        {collapsedHeadline}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      {collapsedHeadline}
                    </TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <>
                  <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="min-w-0 flex-1 line-clamp-1 text-sm font-medium text-foreground">
                        {props.title}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      {props.title}
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {collapsed && isDoneLike ? (
                <Badge variant="secondary" className="shrink-0 gap-1">
                  <CheckCircle2 className="text-muted-foreground" />
                  {completedBadgeText}
                </Badge>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={collapsed ? "Expand" : "Collapse"}
                onClick={() => setCollapsed((v) => !v)}
              >
                {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {!collapsed ? (
            <div className="mt-1 border-t pt-1">
              {planSteps.map((s, idx) => {
                const status: WorkflowAgentProgressStatus =
                  idx < doneCount ? "done" : idx === activeIdx ? "in_progress" : "todo"
                const label = String(s ?? "").trim()
                return (
                  <Row
                    key={`plan:${idx}:${s}`}
                    label={label || `Step ${idx + 1}`}
                    status={status}
                    active={status === "in_progress"}
                    dim={status === "done"}
                    gradientSpinner={status === "in_progress"}
                  />
                )
              })}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

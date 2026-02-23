import * as React from "react"
import { CheckCircle2, ChevronDown, ChevronRight, Circle, ListTodo } from "lucide-react"

import { cn } from "@/lib/utils"
import { GradientCircleArrowRightIcon } from "@/components/icons/GradientCircleArrowRightIcon"

export type WorkflowAgentProgressStatus = "todo" | "in_progress" | "done"
export type WorkflowAgentProgressMode = "planning" | "list"

function StatusMark(props: { status: WorkflowAgentProgressStatus; gradient?: boolean }) {
  if (props.status === "done") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground animate-in fade-in-0 duration-200" />
  }
  if (props.status === "in_progress") {
    return <GradientCircleArrowRightIcon className="h-4 w-4 shrink-0 animate-in fade-in-0 duration-200" />
  }
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
}

function Row(props: {
  label: string
  status: WorkflowAgentProgressStatus
  active?: boolean
  gradientSpinner?: boolean
}) {
  return (
    <div className={cn("flex items-start gap-2 py-1", props.active && "text-foreground")}>
      <StatusMark status={props.status} gradient={props.gradientSpinner} />
      <div
        className={cn(
          "min-w-0 text-xs leading-relaxed",
          props.active &&
            "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-500 bg-clip-text font-medium text-transparent",
          props.status !== "in_progress" && "text-muted-foreground",
        )}
      >
        {props.label}
      </div>
    </div>
  )
}

export function PlanStepsProgress(props: {
  title: string
  generatingPlanText: string
  generatingStepText?: string
  completedCountText?: string
  stepsCountText?: string
  completedStepsCountText?: string
  plan?: { title?: string | null; steps?: Array<{ stepKey?: string; name: string; description: string }> } | null
  draftStepsCount?: number
  done?: boolean
  mode?: WorkflowAgentProgressMode
  idle?: boolean
  className?: string
}) {
  const planSteps = Array.isArray(props.plan?.steps)
    ? (props.plan?.steps as Array<{ name: string; description: string }>)
    : []
  const hasExpandable = planSteps.some((s) => String(s?.name ?? "").trim().length > 0)
  const [open, setOpen] = React.useState<boolean>(() => hasExpandable)
  const hasUserToggledRef = React.useRef(false)

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
  // - A step becomes DONE once its draft node has been emitted (define_step arrived).
  // So: doneCount = draftCount, activeIdx = draftCount (clamped), and when all steps are emitted, no active spinner.
  const doneCount = isDone ? planSteps.length : Math.min(draftCount, planSteps.length)
  const activeIdx = props.idle || isDoneLike ? null : draftCount < planSteps.length ? draftCount : null

  const formatTemplate = React.useCallback((tpl: string | undefined, vars: Record<string, string | number>) => {
    if (!tpl) return ""
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""))
  }, [])

  React.useEffect(() => {
    if (hasUserToggledRef.current) return
    if (hasExpandable) setOpen(true)
  }, [hasExpandable])

  const stepsCountLabel = React.useMemo(() => {
    if (planSteps.length === 0) return ""
    if (doneCount === 0) {
      return formatTemplate(props.stepsCountText, { count: planSteps.length }) || `${planSteps.length} steps`
    }
    const countStr = isDoneLike ? String(planSteps.length) : `${doneCount}/${planSteps.length}`
    return formatTemplate(props.completedStepsCountText, { count: countStr }) || `${countStr} steps completed`
  }, [planSteps.length, doneCount, isDoneLike, formatTemplate, props.stepsCountText, props.completedStepsCountText])

  return (
    <div className={cn("my-1.5 w-full max-w-full overflow-hidden rounded-md border", props.className)}>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors bg-muted/20 hover:bg-muted/40",
          hasExpandable ? "cursor-pointer" : "cursor-default",
        )}
        onClick={() => {
          if (!hasExpandable) return
          hasUserToggledRef.current = true
          setOpen((v) => !v)
        }}
        disabled={!hasExpandable}
      >
        {isPlanning ? (
          <GradientCircleArrowRightIcon className="h-4 w-4 shrink-0 animate-in fade-in-0 duration-200" />
        ) : (
          <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            isPlanning
              ? "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-500 bg-clip-text font-medium text-transparent"
              : "text-muted-foreground",
          )}
        >
          {isPlanning ? props.generatingPlanText : props.title}
        </span>

        {!isPlanning && stepsCountLabel ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">{stepsCountLabel}</span>
        ) : null}

        {hasExpandable ? (
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : null}
      </button>

      {open && hasExpandable ? (
        <div className="border-t px-3 py-2 space-y-2">
          <div className="w-0 min-w-full">
            {planSteps.map((s, idx) => {
              const status: WorkflowAgentProgressStatus =
                idx < doneCount ? "done" : idx === activeIdx ? "in_progress" : "todo"
              const name = String(s?.name ?? "").trim()
              const desc = String(s?.description ?? "").trim()
              const combined = name ? (desc ? `${name} — ${desc}` : name) : `Step ${idx + 1}`
              const label = `${idx + 1}. ${combined}`
              return (
                <Row
                  key={`plan:${idx}:${name || "step"}`}
                  label={label}
                  status={status}
                  active={status === "in_progress"}
                  gradientSpinner={status === "in_progress"}
                />
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

"use client"

import * as React from "react"
import { CheckCircle2, Play, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { PlanStepsProgress } from "@/components/workflows/agent/plan-steps-progress"
import type { AgentMode } from "@/lib/shared/agent/modes"

type OrchestratorProgress = {
  plan?: { title?: string | null; steps?: Array<{ stepKey?: string; name: string; description: string }> } | null
  draftStepsCount: number
  done: boolean
} | null

export type PlanProgressCardProps = {
  title: string
  summary?: string
  t: (k: string) => string
  streaming?: boolean

  /** Static step names (plan_ready initial display before build starts). */
  steps?: string[]

  /** Highlights shown below the progress list. Omit or pass [] to hide. */
  highlights?: string[]

  /**
   * When provided, enables build actions (plan mode).
   * Omit for agent mode — the card will only show header + progress.
   */
  onBuild?: () => void
  onContinuePlanning?: () => void
  onModeSwitch?: (mode: AgentMode) => void
  planBuildActive?: boolean
  orchestratorProgress?: OrchestratorProgress
}

export function PlanProgressCard(props: PlanProgressCardProps) {
  const {
    title,
    summary,
    steps = [],
    highlights = [],
    t,
    streaming,
    onBuild,
    onContinuePlanning,
    planBuildActive,
    orchestratorProgress,
  } = props

  const hasActions = !!onBuild
  const hasHighlights = highlights.length > 0

  // --- Build state (only relevant for plan mode with actions) ---
  const [localState, setLocalState] = React.useState<"pending" | "building" | "dismissed">("pending")
  const state = hasActions ? (planBuildActive ? "building" : localState) : "building"

  // ⌘+Enter shortcut (plan mode only)
  React.useEffect(() => {
    if (!hasActions || state !== "pending" || streaming) return
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault()
        setLocalState("building")
        onBuild?.()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [hasActions, state, streaming, onBuild])

  // --- Progress display ---
  const staticPlanSteps = React.useMemo(() => steps.map((s) => ({ name: s, description: "" })), [steps])

  const displayPlan = hasActions
    ? { title, steps: staticPlanSteps }
    : (orchestratorProgress?.plan ?? (staticPlanSteps.length > 0 ? { title, steps: staticPlanSteps } : null))

  const historicalDone = !hasActions && !orchestratorProgress
  const displayDraftStepsCount = orchestratorProgress
    ? orchestratorProgress.draftStepsCount
    : historicalDone
      ? staticPlanSteps.length
      : 0
  const displayDone = orchestratorProgress ? orchestratorProgress.done : historicalDone

  return (
    <div className="my-2 w-full max-w-full overflow-hidden rounded-lg border divide-y">
      {/* Header: title + summary */}
      <div className="space-y-1 bg-muted/20 px-3 py-2.5">
        <p className="text-sm font-medium leading-snug">
          {title || (streaming ? t("agent.mode.planReady.buildPlan") : "")}
        </p>
        {summary ? <p className="text-xs leading-relaxed text-muted-foreground">{summary}</p> : null}
      </div>

      {/* Steps progress — wrapped to isolate PlanStepsProgress's border-0 from divide-y */}
      <div>
        <PlanStepsProgress
          title={t("agent.mode.planReady.buildPlan")}
          generatingPlanText={t("workflows.orchestrator.generatingPlan")}
          generatingStepText={t("workflows.orchestrator.progress.generatingStep")}
          completedCountText={t("workflows.orchestrator.progress.completedCount")}
          stepsCountText={t("workflows.orchestrator.progress.stepsCount")}
          completedStepsCountText={t("workflows.orchestrator.progress.completedStepsCount")}
          plan={displayPlan}
          draftStepsCount={displayDraftStepsCount}
          done={displayDone}
          mode="list"
          idle={hasActions && (state === "pending" || state === "dismissed")}
          className="rounded-none border-0 my-0"
        />
      </div>

      {/* Highlights */}
      {hasHighlights ? (
        <div className="flex items-start gap-2 px-3 py-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">{highlights.join(" · ")}</p>
        </div>
      ) : null}

      {/* Actions (plan mode only) */}
      {hasActions && !streaming && state === "pending" ? (
        <div className="flex items-center justify-end gap-2 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setLocalState("dismissed")
              onContinuePlanning?.()
            }}
          >
            {t("agent.mode.planReady.continuePlanning")}
          </Button>
          <Button
            variant="default"
            size="sm"
            className={cn("h-7 gap-1.5 text-xs")}
            onClick={() => {
              setLocalState("building")
              onBuild?.()
            }}
          >
            <Play className="h-3 w-3" />
            {t("agent.mode.planReady.build")}
            <Kbd className="ml-1 bg-transparent text-primary-foreground">⌘↵</Kbd>
          </Button>
        </div>
      ) : hasActions && !streaming && state === "building" ? (
        <div className="flex items-center justify-end gap-2 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("agent.mode.planReady.started")}
          </p>
        </div>
      ) : null}
    </div>
  )
}

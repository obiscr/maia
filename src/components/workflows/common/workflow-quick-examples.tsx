"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Wand2,
  Circle,
  CircleDot,
  Zap,
  WorkflowIcon,
  PlayIcon,
  Clock,
  Layers,
  ListChecks,
  Activity,
} from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  WORKFLOW_TEMPLATES,
  getWorkflowTemplatePrompt,
  MODULE_ACTIONS_BY_MODULE,
  getModuleActionPrompt,
  type WorkflowTemplateDifficulty,
  type WorkflowTemplateId,
  type AgentModule,
  type ModuleActionId,
} from "@/lib/shared/workflow-example-prompts"

// ---- Shared utilities -----------------------------------------------------

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickRandomUnique<T>(arr: T[], count: number, rng: () => number): T[] {
  const n = Math.max(0, Math.min(count, arr.length))
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ---- Workflow template chips (difficulty badges) --------------------------

function difficultyBadgeClass(d: WorkflowTemplateDifficulty) {
  if (d === "hard")
    return "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30 dark:border-violet-500/20"
  if (d === "medium")
    return "border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/10 dark:bg-amber-500/5"
  return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300 dark:bg-emerald-500/5"
}

function difficultyIcon(d: WorkflowTemplateDifficulty) {
  if (d === "hard") return Zap
  if (d === "medium") return CircleDot
  return Circle
}

// ---- Module action icons ---------------------------------------------------

const MODULE_ICONS: Record<AgentModule, React.ComponentType<{ className?: string }>> = {
  workflow: WorkflowIcon,
  run: PlayIcon,
  job: ListChecks,
  schedule: Clock,
  batch: Layers,
  operation: Activity,
}

const WORKFLOW_TEMPLATE_TITLE_KEYS = {
  web_summary: "workflows.orchestrator.examples.templates.web_summary.title",
  csv_stats: "workflows.orchestrator.examples.templates.csv_stats.title",
  json_validate: "workflows.orchestrator.examples.templates.json_validate.title",
  rss_digest: "workflows.orchestrator.examples.templates.rss_digest.title",
  image_ocr: "workflows.orchestrator.examples.templates.image_ocr.title",
  video_takeaways: "workflows.orchestrator.examples.templates.video_takeaways.title",
  markdown_outline: "workflows.orchestrator.examples.templates.markdown_outline.title",
  log_errors: "workflows.orchestrator.examples.templates.log_errors.title",
  review_sentiment: "workflows.orchestrator.examples.templates.review_sentiment.title",
  invoice_parse: "workflows.orchestrator.examples.templates.invoice_parse.title",
  issue_triage: "workflows.orchestrator.examples.templates.issue_triage.title",
  data_schema: "workflows.orchestrator.examples.templates.data_schema.title",
  news_merge: "workflows.orchestrator.examples.templates.news_merge.title",
  ab_analysis: "workflows.orchestrator.examples.templates.ab_analysis.title",
  ticket_routing: "workflows.orchestrator.examples.templates.ticket_routing.title",
  doc_summary: "workflows.orchestrator.examples.templates.doc_summary.title",
  etl_pipeline: "workflows.orchestrator.examples.templates.etl_pipeline.title",
  site_monitor: "workflows.orchestrator.examples.templates.site_monitor.title",
  knowledge_base: "workflows.orchestrator.examples.templates.knowledge_base.title",
  branching_workflow: "workflows.orchestrator.examples.templates.branching_workflow.title",
} as const satisfies Record<WorkflowTemplateId, string>

const WORKFLOW_TEMPLATE_DIFFICULTY_KEYS = {
  simple: "workflows.orchestrator.examples.difficulty.simple",
  medium: "workflows.orchestrator.examples.difficulty.medium",
  hard: "workflows.orchestrator.examples.difficulty.hard",
} as const satisfies Record<WorkflowTemplateDifficulty, string>

const MODULE_ACTION_TITLE_KEYS = {
  workflow_list: "workflows.orchestrator.examples.actions.workflow_list.title",
  workflow_versions: "workflows.orchestrator.examples.actions.workflow_versions.title",
  run_failures: "workflows.orchestrator.examples.actions.run_failures.title",
  run_results: "workflows.orchestrator.examples.actions.run_results.title",
  job_run: "workflows.orchestrator.examples.actions.job_run.title",
  job_status: "workflows.orchestrator.examples.actions.job_status.title",
  schedule_create: "workflows.orchestrator.examples.actions.schedule_create.title",
  schedule_overview: "workflows.orchestrator.examples.actions.schedule_overview.title",
  batch_create: "workflows.orchestrator.examples.actions.batch_create.title",
  batch_progress: "workflows.orchestrator.examples.actions.batch_progress.title",
  operation_log: "workflows.orchestrator.examples.actions.operation_log.title",
  operation_overview: "workflows.orchestrator.examples.actions.operation_overview.title",
} as const satisfies Record<ModuleActionId, string>

// ---- usePick callback -----------------------------------------------------

function usePickHandler(behavior: "fill" | "navigate", agentHref: string, onPickProp?: (prompt: string) => void) {
  const router = useRouter()
  return React.useCallback(
    (prompt: string) => {
      if (behavior === "navigate") {
        try {
          sessionStorage.setItem("maia.workflows.orchestrator.initialPrompt", prompt)
          router.push(agentHref)
          return
        } catch {
          router.push(`${agentHref}?prompt=${encodeURIComponent(prompt)}`)
          return
        }
      }
      onPickProp?.(prompt)
    },
    [agentHref, behavior, onPickProp, router],
  )
}

// ---- Chip button ----------------------------------------------------------

function ChipButton(props: {
  icon: React.ComponentType<{ className?: string }>
  iconClassName?: string
  title: string
  prompt: string
  badge?: React.ReactNode
  onPick: (prompt: string) => void
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => props.onPick(props.prompt)}
      className={cn(
        "inline-flex w-full sm:w-auto min-w-0 max-w-full overflow-hidden items-center justify-start gap-2 rounded-full border bg-background px-3 py-1.5 text-sm text-left",
        "h-auto font-[inherit] text-[inherit] hover:text-[inherit]",
        "transition-colors hover:bg-accent active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        props.className,
      )}
      title={props.prompt}
    >
      <props.icon className={cn("h-4 w-4 shrink-0 text-muted-foreground", props.iconClassName)} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{props.title}</span>
      <span className="shrink-0">{props.badge}</span>
    </Button>
  )
}

// ===========================================================================
// WorkflowQuickExamples – shows workflow template chips only
// Used by workflow pages and inline agent workflow editing.
// ===========================================================================

export function WorkflowQuickExamples(props: {
  count: number
  behavior?: "fill" | "navigate"
  onPick?: (prompt: string) => void
  agentHref?: string
  className?: string
  layout?: "wrap" | "grid"
}) {
  const { t, locale } = useI18n()
  const behavior = props.behavior ?? (props.onPick ? "fill" : "navigate")
  const agentHref = props.agentHref ?? "/agent"
  const reactId = React.useId()
  const seedRef = React.useRef<number>(hashSeed(reactId))

  const selected = React.useMemo(() => {
    const rng = mulberry32(seedRef.current + (props.count ?? 0))
    return pickRandomUnique(WORKFLOW_TEMPLATES, props.count, rng)
  }, [props.count])

  const onPick = usePickHandler(behavior, agentHref, props.onPick)

  return (
    <div className={cn("flex max-w-full min-w-0 flex-wrap gap-2 overflow-x-hidden", props.className)}>
      {selected.map((tpl) => {
        const titleKey = WORKFLOW_TEMPLATE_TITLE_KEYS[tpl.id]
        const title = t(titleKey)
        const prompt = getWorkflowTemplatePrompt(locale, tpl.id)
        const diffLabelKey = WORKFLOW_TEMPLATE_DIFFICULTY_KEYS[tpl.difficulty]
        const diffLabel = t(diffLabelKey)
        const DiffIcon = difficultyIcon(tpl.difficulty)
        return (
          <ChipButton
            key={tpl.id}
            icon={Wand2}
            title={title}
            prompt={prompt}
            onPick={onPick}
            badge={
              <Badge
                variant="outline"
                className={cn("ml-1 inline-flex items-center gap-1", difficultyBadgeClass(tpl.difficulty))}
                aria-label={`${diffLabel} difficulty`}
              >
                <DiffIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{diffLabel}</span>
              </Badge>
            }
          />
        )
      })}
    </div>
  )
}

// ===========================================================================
// AgentQuickExamples – combined layout:
//   Top:    workflow template chips (flowing)
//   Bottom: module action grid (responsive CSS grid)
// ===========================================================================

const NAV_KEYS: Record<AgentModule, string> = {
  workflow: "nav.workflows",
  run: "nav.runs",
  job: "nav.jobs",
  schedule: "nav.schedules",
  batch: "nav.batches",
  operation: "nav.operations",
}

const MODULE_ORDER: AgentModule[] = ["workflow", "run", "job", "schedule", "batch", "operation"]

export function AgentQuickExamples(props: {
  templateCount?: number
  actionsPerModule?: number
  behavior?: "fill" | "navigate"
  onPick?: (prompt: string) => void
  agentHref?: string
  className?: string
}) {
  const { t, locale } = useI18n()
  const behavior = props.behavior ?? (props.onPick ? "fill" : "navigate")
  const agentHref = props.agentHref ?? "/agent"
  const templateCount = props.templateCount ?? 6
  const actionsPerModule = props.actionsPerModule ?? 1

  const onPick = usePickHandler(behavior, agentHref, props.onPick)

  const reactId = React.useId()
  const seedRef = React.useRef<number>(hashSeed(reactId + "actions"))

  const pickedActions = React.useMemo(() => {
    const rng = mulberry32(seedRef.current)
    return MODULE_ORDER.flatMap((mod) => {
      const picked = pickRandomUnique(MODULE_ACTIONS_BY_MODULE[mod], actionsPerModule, rng)
      return picked.map((action) => ({ mod, action }))
    })
  }, [actionsPerModule])

  return (
    <div className={cn("space-y-5", props.className)}>
      {/* Workflow template chips */}
      <WorkflowQuickExamples
        count={templateCount}
        behavior={behavior}
        onPick={props.onPick}
        agentHref={agentHref}
        className="justify-center"
      />

      {/* Module action chips – flowing layout, 1 random action per module */}
      <div className="flex max-w-full min-w-0 flex-wrap gap-2 overflow-x-hidden justify-center">
        {pickedActions.map(({ mod, action }) => {
          const Icon = MODULE_ICONS[mod]
          const moduleLabelKey = NAV_KEYS[mod]
          const moduleLabel = t(moduleLabelKey)
          const titleKey = MODULE_ACTION_TITLE_KEYS[action.id]
          const title = t(titleKey)
          const prompt = getModuleActionPrompt(locale, action.id)
          return (
            <ChipButton
              key={action.id}
              icon={Icon}
              title={title}
              prompt={prompt}
              onPick={onPick}
              badge={
                <Badge variant="outline" className="ml-1 inline-flex items-center text-muted-foreground border-border">
                  {moduleLabel}
                </Badge>
              }
            />
          )
        })}
      </div>
    </div>
  )
}

"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Wand2, Circle, CircleDot, Zap } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getWorkflowExamplePrompt, type WorkflowExampleId } from "@/lib/shared/workflow-example-prompts"

export type WorkflowQuickExampleDifficulty = "simple" | "medium" | "hard"

type WorkflowQuickExampleMeta = {
  id: WorkflowExampleId
  difficulty: WorkflowQuickExampleDifficulty
  titleKey: string
  difficultyKey: string
}

const EXAMPLE_META: WorkflowQuickExampleMeta[] = [
  // Simple (<= 15 steps)
  {
    id: "ex1",
    difficulty: "simple",
    titleKey: "workflows.orchestrator.examples.items.ex1.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.simple",
  },
  {
    id: "ex2",
    difficulty: "simple",
    titleKey: "workflows.orchestrator.examples.items.ex2.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.simple",
  },
  {
    id: "ex3",
    difficulty: "simple",
    titleKey: "workflows.orchestrator.examples.items.ex3.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.simple",
  },
  {
    id: "ex4",
    difficulty: "simple",
    titleKey: "workflows.orchestrator.examples.items.ex4.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.simple",
  },
  {
    id: "ex5",
    difficulty: "simple",
    titleKey: "workflows.orchestrator.examples.items.ex5.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.simple",
  },
  {
    id: "ex6",
    difficulty: "simple",
    titleKey: "workflows.orchestrator.examples.items.ex6.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.simple",
  },
  {
    id: "ex7",
    difficulty: "simple",
    titleKey: "workflows.orchestrator.examples.items.ex7.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.simple",
  },
  {
    id: "ex8",
    difficulty: "simple",
    titleKey: "workflows.orchestrator.examples.items.ex8.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.simple",
  },
  // Medium (15–30 steps)
  {
    id: "ex9",
    difficulty: "medium",
    titleKey: "workflows.orchestrator.examples.items.ex9.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.medium",
  },
  {
    id: "ex10",
    difficulty: "medium",
    titleKey: "workflows.orchestrator.examples.items.ex10.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.medium",
  },
  {
    id: "ex11",
    difficulty: "medium",
    titleKey: "workflows.orchestrator.examples.items.ex11.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.medium",
  },
  {
    id: "ex12",
    difficulty: "medium",
    titleKey: "workflows.orchestrator.examples.items.ex12.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.medium",
  },
  {
    id: "ex13",
    difficulty: "medium",
    titleKey: "workflows.orchestrator.examples.items.ex13.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.medium",
  },
  {
    id: "ex14",
    difficulty: "medium",
    titleKey: "workflows.orchestrator.examples.items.ex14.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.medium",
  },
  {
    id: "ex15",
    difficulty: "medium",
    titleKey: "workflows.orchestrator.examples.items.ex15.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.medium",
  },
  // Hard (>= 30 steps)
  {
    id: "ex16",
    difficulty: "hard",
    titleKey: "workflows.orchestrator.examples.items.ex16.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.hard",
  },
  {
    id: "ex17",
    difficulty: "hard",
    titleKey: "workflows.orchestrator.examples.items.ex17.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.hard",
  },
  {
    id: "ex18",
    difficulty: "hard",
    titleKey: "workflows.orchestrator.examples.items.ex18.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.hard",
  },
  {
    id: "ex19",
    difficulty: "hard",
    titleKey: "workflows.orchestrator.examples.items.ex19.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.hard",
  },
  {
    id: "ex20",
    difficulty: "hard",
    titleKey: "workflows.orchestrator.examples.items.ex20.title",
    difficultyKey: "workflows.orchestrator.examples.difficulty.hard",
  },
]

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
  // Fisher–Yates shuffle with seeded RNG
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

function hashSeed(s: string): number {
  // Deterministic, cheap string hash (FNV-1a 32-bit-ish)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function difficultyBadgeVariant(d: WorkflowQuickExampleDifficulty) {
  // Use outline variant for all difficulties to maintain consistency
  // Color differentiation is handled via custom classes
  return "outline" as const
}

function difficultyBadgeClass(d: WorkflowQuickExampleDifficulty) {
  // Improved color scheme: avoid red for "hard" as it implies error/danger
  // Instead use purple/violet which is neutral and commonly used for "advanced" or "complex"
  if (d === "hard")
    return "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30 dark:border-violet-500/20"
  if (d === "medium")
    return "border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/10 dark:bg-amber-500/5"
  return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300 dark:bg-emerald-500/5"
}

function difficultyIcon(d: WorkflowQuickExampleDifficulty) {
  // Use icons to provide visual redundancy beyond color
  // This improves accessibility and recognition
  if (d === "hard") return Zap
  if (d === "medium") return CircleDot
  return Circle
}

export function WorkflowQuickExamples(props: {
  /** How many items to display. */
  count: number
  /** Fill composer, or navigate to agent page. */
  behavior?: "fill" | "navigate"
  /** Used when behavior="fill" */
  onPick?: (prompt: string) => void
  /** Used when behavior="navigate" */
  agentHref?: string
  className?: string
  /** Layout: "wrap" is a natural flowing chip layout (recommended). */
  layout?: "wrap" | "grid"
}) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const behavior = props.behavior ?? (props.onPick ? "fill" : "navigate")
  const agentHref = props.agentHref ?? "/agent"
  const layout = props.layout ?? "wrap"
  // IMPORTANT: Do not use Math.random() for initial render; this component is SSR'd and must hydrate deterministically.
  // useId() is stable between server and client for the same tree position, so it's a safe seed source.
  const reactId = React.useId()
  const seedRef = React.useRef<number>(hashSeed(reactId))

  const selected = React.useMemo(() => {
    const rng = mulberry32(seedRef.current + (props.count ?? 0))
    return pickRandomUnique(EXAMPLE_META, props.count, rng)
  }, [props.count])

  const onPick = React.useCallback(
    (prompt: string) => {
      if (behavior === "navigate") {
        // Prefer sessionStorage to avoid URL-length limits and leaking prompt into URLs/logs.
        try {
          sessionStorage.setItem("maia.workflows.orchestrator.initialPrompt", prompt)
          router.push(agentHref)
          return
        } catch {
          // Fallback for environments where storage is blocked/unavailable.
          router.push(`${agentHref}?prompt=${encodeURIComponent(prompt)}`)
          return
        }
      }
      props.onPick?.(prompt)
    },
    [agentHref, behavior, props, router],
  )

  // Prefer flowing "chips": each item sizes to its text; if it doesn't fit, it moves to the next line.
  // "grid" is kept for compatibility but behaves the same (no forced spans).
  return (
    <div className={cn("flex max-w-full min-w-0 flex-wrap gap-2 overflow-x-hidden", props.className)}>
      {selected.map((ex) => {
        const title = t(ex.titleKey)
        const prompt = getWorkflowExamplePrompt(locale, ex.id)
        const diffLabel = t(ex.difficultyKey)
        return (
          <button
            key={ex.id}
            type="button"
            onClick={() => onPick(prompt)}
            className={cn(
              // On small screens, make each item full width to avoid horizontal overflow.
              // Also force flex items to be shrinkable (min-w-0) so truncation can work.
              "inline-flex w-full sm:w-auto min-w-0 max-w-full overflow-hidden items-center justify-start gap-2 rounded-full border bg-background px-3 py-1.5 text-sm text-left",
              "transition-colors hover:bg-accent active:scale-[0.99]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
            title={prompt}
          >
            <Wand2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 line-clamp-1">{title}</span>
            <Badge
              variant={difficultyBadgeVariant(ex.difficulty)}
              className={cn("ml-1 inline-flex items-center gap-1", difficultyBadgeClass(ex.difficulty))}
              aria-label={`${diffLabel} difficulty`}
            >
              {React.createElement(difficultyIcon(ex.difficulty), {
                className: "h-3 w-3 shrink-0",
                "aria-hidden": "true",
              })}
              <span>{diffLabel}</span>
            </Badge>
          </button>
        )
      })}
    </div>
  )
}

"use client"

import * as React from "react"
import { Check } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import { Field, FieldLabel } from "@/components/ui/field"
import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"

import type { StepId } from "./types"

export function Stepper({
  current,
  steps,
}: {
  current: StepId
  steps: { id: StepId; titleKey: string; shortKey?: string; descriptionKey: string }[]
}) {
  const { t } = useI18n()
  const idx = Math.max(
    0,
    steps.findIndex((s) => s.id === current),
  )
  const pct = steps.length > 1 ? Math.round((idx / (steps.length - 1)) * 100) : 0
  const cur = steps[idx]
  const progressId = React.useId()
  return (
    <Field className="w-full gap-3">
      <FieldLabel htmlFor={progressId} className="w-full">
        {/* Mobile: icon + title only (no right-side meta) */}
        <div className="flex w-full items-center gap-2 md:hidden">
          <div
            className={cn(
              "flex size-7 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
              "border-primary bg-primary text-primary-foreground",
            )}
            aria-hidden="true"
          >
            {idx + 1}
          </div>
          <div className="min-w-0 truncate text-sm font-semibold">
            {cur ? t(cur.titleKey) : t("setupWizard.fallbackStep")}
          </div>
        </div>

        {/* Desktop: stepper row (sketch-style) */}
        <div className="hidden w-full md:flex items-start justify-between gap-6">
          {steps.map((s, i) => {
            const isCurrent = i === idx
            const isComplete = i < idx
            const label = t(s.shortKey ?? s.titleKey)
            return (
              <div key={s.id} className="flex min-w-0 flex-1 flex-col items-center text-center">
                <div
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
                    isComplete && "border-primary/30 bg-primary/10 text-primary",
                    isCurrent && "border-primary bg-primary text-primary-foreground",
                    !isComplete && !isCurrent && "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {isComplete ? <Check className="size-4" aria-hidden="true" /> : i + 1}
                </div>
                <div className={cn("mt-2 truncate text-sm font-semibold", isCurrent && "text-primary")}>{label}</div>
              </div>
            )
          })}
        </div>
      </FieldLabel>
      <Progress value={pct} id={progressId} />
      {cur ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="min-w-0 flex-1 truncate">{t(cur.descriptionKey)}</div>
          <div className="shrink-0 tabular-nums">{pct}%</div>
        </div>
      ) : null}
    </Field>
  )
}

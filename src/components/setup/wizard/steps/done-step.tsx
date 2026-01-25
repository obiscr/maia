"use client"

import * as React from "react"
import { ArrowRight, CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"

import { useSetupWizardFooter } from "../footer-context"

export function DoneStep({ active = true }: { active?: boolean }) {
  const { t } = useI18n()
  useSetupWizardFooter(
    () => (
      <div className="flex items-center justify-end">
        <Button size="sm" asChild>
          <a href="/" className="inline-flex items-center gap-2">
            <span>{t("setupWizard.done.enterAppAction")}</span>
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </Button>
      </div>
    ),
    [t],
    active,
  )

  return (
    <div className="text-center">
      <div className="flex justify-center items-center gap-2">
        <CheckCircle2
          className="maia-status-badge--success size-6 text-[color:var(--maia-status-text)]"
          aria-hidden="true"
        />
        <div className="text-xl font-bold">{t("setupWizard.done.completedTitle")}</div>
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{t("setupWizard.done.completedHint")}</div>
    </div>
  )
}

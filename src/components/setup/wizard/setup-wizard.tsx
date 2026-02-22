"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SectionCard, SectionCardBody, SectionCardFooter, SectionCardHeader } from "@/components/common/section-card"
import { BrandedSectionCardLayout } from "@/components/common/branded-section-card-layout"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"

import { STEPS } from "./constants"
import { SetupWizardFooterContext } from "./footer-context"
import { SetupWizardStatusContext } from "./status-context"
import { Stepper } from "./stepper"
import type { AuthStatus, StepId } from "./types"

import { AppearanceStep } from "./steps/appearance-step"
import { DataDirStep } from "./steps/data-dir-step"
import { AdminStep } from "./steps/admin-step"
import { DoneStep } from "./steps/done-step"

export function SetupWizard() {
  const { t } = useI18n()
  const [step, setStep] = React.useState<StepId>("appearance")
  // Default footer: avoid a blank area on initial paint/hydration.
  // Step components will replace this via `useSetupWizardFooter`.
  const [footer, setFooter] = React.useState<React.ReactNode>(() => (
    <div className="flex items-center justify-end gap-2">
      <Button size="sm" disabled>
        {t("setupWizard.actions.saveAndContinueAction")}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  ))
  const router = useRouter()
  const [status, setStatus] = React.useState<AuthStatus | null>(null)
  const [statusLoading, setStatusLoading] = React.useState(true)
  const [dataDirCommitted, setDataDirCommitted] = React.useState(false)
  const markDataDirCommitted = React.useCallback(() => setDataDirCommitted(true), [])
  const [mountedSteps, setMountedSteps] = React.useState<Record<StepId, boolean>>({
    appearance: true,
    data: false,
    admin: false,
    done: false,
  })

  const refreshStatus = React.useCallback(async () => {
    setStatusLoading(true)
    try {
      const s = await apiFetchJson<AuthStatus>("/api/auth/status", { method: "GET" })
      setStatus(s)
      return s
    } catch {
      toast.error(t("common.loadFailed"))
      return null
    } finally {
      setStatusLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const initialized = Boolean(status?.installed || status?.hasUsers)
  const installed = Boolean(status?.installed)
  const hasUsers = Boolean(status?.hasUsers)

  // Global guard: once initialized, the rest of the wizard requires auth.
  React.useEffect(() => {
    if (!status) return
    if (installed && !hasUsers) {
      router.replace("/setup/repair")
      router.refresh()
      return
    }
    if (initialized && !status.user) {
      router.replace("/signin")
      router.refresh()
    }
  }, [hasUsers, initialized, installed, router, status])

  const allowedStepIds = React.useMemo(() => STEPS.map((s) => s.id), [])

  // Ensure current step is always within allowed steps.
  React.useEffect(() => {
    if (allowedStepIds.length <= 0) return
    if (!allowedStepIds.includes(step)) setStep(allowedStepIds[0])
  }, [allowedStepIds, step])

  // Keep the browser tab title synced with the current step.
  React.useEffect(() => {
    const cur = STEPS.find((s) => s.id === step)
    const stepTitle = cur ? t(cur.titleKey) : t("setupWizard.fallbackStep")
    document.title = `${stepTitle} - ${t("setupWizard.title")}`
  })

  // Mount a step the first time it is visited, so its local state persists on back/next
  // without eagerly mounting future steps (which could trigger unauthorized API calls).
  React.useEffect(() => {
    setMountedSteps((prev) => (prev[step] ? prev : { ...prev, [step]: true }))
  }, [step])

  const goBack = React.useCallback(() => {
    setStep((cur) => {
      const idx = allowedStepIds.indexOf(cur)
      if (idx <= 0) return cur
      return allowedStepIds[idx - 1] ?? cur
    })
  }, [allowedStepIds])

  const goNext = React.useCallback(() => {
    setStep((cur) => {
      const idx = allowedStepIds.indexOf(cur)
      if (idx < 0 || idx >= allowedStepIds.length - 1) return cur
      return allowedStepIds[idx + 1] ?? cur
    })
  }, [allowedStepIds])

  const footerCtx = React.useMemo(() => ({ setFooter }), [setFooter])

  return (
    <SetupWizardFooterContext.Provider value={footerCtx}>
      <SetupWizardStatusContext.Provider value={{ status, statusLoading, initialized, refreshStatus }}>
        <BrandedSectionCardLayout title={t("setupWizard.title")}>
          <SectionCard className="shadow-sm">
            <SectionCardHeader className="px-4 py-3 sm:px-5 sm:py-4">
              <Stepper current={step} steps={STEPS} />
            </SectionCardHeader>

            {step !== "done" ? (
              <SectionCardBody className="px-4 py-3 sm:px-5 sm:py-4">
                <div className="space-y-4">
                  {mountedSteps.appearance ? (
                    <div hidden={step !== "appearance"} aria-hidden={step !== "appearance"}>
                      <AppearanceStep onNext={goNext} active={step === "appearance"} />
                    </div>
                  ) : null}

                  {mountedSteps.data ? (
                    <div hidden={step !== "data"} aria-hidden={step !== "data"}>
                      <DataDirStep
                        onBack={goBack}
                        onNext={goNext}
                        active={step === "data"}
                        committed={dataDirCommitted}
                        onCommitted={markDataDirCommitted}
                      />
                    </div>
                  ) : null}

                  {mountedSteps.admin ? (
                    <div hidden={step !== "admin"} aria-hidden={step !== "admin"}>
                      <AdminStep onBack={goBack} onNext={goNext} active={step === "admin"} />
                    </div>
                  ) : null}
                </div>
              </SectionCardBody>
            ) : (
              <SectionCardBody className="px-4 py-8 sm:px-5 sm:py-10">
                <div className="flex items-center justify-center">
                  <DoneStep active />
                </div>
              </SectionCardBody>
            )}

            <SectionCardFooter className="px-4 py-3 text-sm sm:px-5 sm:py-4">{footer}</SectionCardFooter>
          </SectionCard>
        </BrandedSectionCardLayout>
      </SetupWizardStatusContext.Provider>
    </SetupWizardFooterContext.Provider>
  )
}

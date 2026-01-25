import type * as React from "react"

export type StepId = "appearance" | "data" | "admin" | "done"

export type AuthStatus = {
  installed: boolean
  registrationMode?: string
  hasUsers: boolean
  user: { email: string; name: string | null } | null
}

export type AdminFormErrors = Partial<Record<"name" | "email" | "password" | "confirmPassword", string>>

export type SmtpFormErrors = Partial<
  Record<"smtpHost" | "smtpPort" | "smtpPassword" | "smtpFromEmail" | "smtpTestTo", string>
>

export type SetupWizardFooterContextValue = {
  setFooter: React.Dispatch<React.SetStateAction<React.ReactNode>>
}

export type SetupWizardStatusContextValue = {
  status: AuthStatus | null
  statusLoading: boolean
  initialized: boolean
  refreshStatus: () => Promise<AuthStatus | null>
}

export type StepDef = { id: StepId; titleKey: string; shortKey: string; descriptionKey: string }

"use client"

import * as React from "react"

import type { SetupWizardStatusContextValue } from "./types"

export const SetupWizardStatusContext = React.createContext<SetupWizardStatusContextValue | null>(null)

export function useSetupWizardStatus() {
  const ctx = React.useContext(SetupWizardStatusContext)
  if (!ctx) throw new Error("useSetupWizardStatus must be used within SetupWizardStatusContext.Provider")
  return ctx
}

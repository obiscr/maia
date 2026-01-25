"use client"

import * as React from "react"

import type { SetupWizardFooterContextValue } from "./types"

export const SetupWizardFooterContext = React.createContext<SetupWizardFooterContextValue | null>(null)

export function useSetupWizardFooter(
  factory: () => React.ReactNode,
  deps: React.DependencyList,
  enabled: boolean = true,
) {
  const ctx = React.useContext(SetupWizardFooterContext)
  const node = React.useMemo(factory, deps)
  React.useLayoutEffect(() => {
    if (!ctx) return
    if (!enabled) return
    ctx.setFooter(node)
    return () => {
      ctx.setFooter((prev) => (prev === node ? null : prev))
    }
  }, [ctx, node, enabled])
}

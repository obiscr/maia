"use client"

import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A wrapper that groups multiple SettingsSection blocks.
 *
 * Usage:
 * <SettingsSectionGroup>
 *   <SettingsSection>...</SettingsSection>
 *   <SettingsSection>...</SettingsSection>
 * </SettingsSectionGroup>
 */
export function SettingsSectionGroup(props: {
  children: React.ReactNode
  className?: string
  wrapperProps?: React.ComponentProps<"div">
}) {
  const { wrapperProps } = props
  const { className: wrapperClassName, ...restWrapperProps } = wrapperProps ?? {}

  return (
    <div {...restWrapperProps} className={cn("w-full max-w-3xl space-y-10", wrapperClassName, props.className)}>
      {props.children}
    </div>
  )
}

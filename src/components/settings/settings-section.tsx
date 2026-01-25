"use client"

import type * as React from "react"

import { cn } from "@/lib/utils"

export function SettingsSection(props: {
  children: React.ReactNode
  className?: string
  wrapperProps?: React.ComponentProps<"div">
}) {
  const { wrapperProps } = props
  const { className: wrapperClassName, ...restWrapperProps } = wrapperProps ?? {}

  return (
    <div {...restWrapperProps} className={cn("w-full max-w-3xl space-y-6", wrapperClassName, props.className)}>
      {props.children}
    </div>
  )
}

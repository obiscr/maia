"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function SettingsSectionContent(props: { children: ReactNode; className?: string }) {
  return <div className={cn(props.className)}>{props.children}</div>
}

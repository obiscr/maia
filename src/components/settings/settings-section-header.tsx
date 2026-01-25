"use client"

import type { ReactNode } from "react"

import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export function SettingsSectionHeader(props: { title: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-3", props.className)}>
      <div className="text-xl font-semibold leading-none tracking-tight">{props.title}</div>
      <Separator />
      {props.description ? <div className="text-sm text-muted-foreground">{props.description}</div> : null}
    </div>
  )
}

"use client"

import * as React from "react"

import { PageTitleBar } from "@/components/common/item-list-header"
import { cn } from "@/lib/utils"

export type StandardPageHeaderProps = {
  title: React.ReactNode
  description?: React.ReactNode

  /**
   * Right-side controls rendered next to the title.
   * Use this for anything from a simple button row to a full `ListSearch` component.
   */
  right?: React.ReactNode

  /**
   * Optional secondary row under the title bar (e.g. mobile action row, filters, status).
   * Caller controls visibility (e.g. `lg:hidden`) and layout.
   */
  bottom?: React.ReactNode

  className?: string
}

export function StandardPageHeader(props: StandardPageHeaderProps) {
  return (
    <div className={cn("space-y-4", props.className)}>
      <PageTitleBar title={props.title} description={props.description} right={props.right} />
      {props.bottom}
    </div>
  )
}

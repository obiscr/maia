"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { CollapsibleCard } from "@/components/common/collapsible-card"
import { SectionCardBody, SectionCardHeader } from "@/components/common/section-card"

type ToggleAriaLabel = string | ((open: boolean) => string)

function hasRenderableChildren(children: React.ReactNode) {
  return React.Children.count(children) > 0
}

export function CollapsibleSectionCard(props: {
  title: React.ReactNode
  icon?: React.ReactNode
  right?: React.ReactNode

  /** Uncontrolled initial state */
  defaultOpen?: boolean
  /** Controlled state */
  open?: boolean
  /** Called for both controlled and uncontrolled usage */
  onOpenChange?: (open: boolean) => void

  /** When closed, prevent expanding */
  disableExpand?: boolean
  /** When open, prevent collapsing */
  disableCollapse?: boolean

  /** Force-hide body even if children are provided */
  showBody?: boolean

  toggleAriaLabel?: ToggleAriaLabel

  className?: string
  headerClassName?: string
  bodyClassName?: string
  children?: React.ReactNode
}) {
  const toggleAriaLabel: ToggleAriaLabel =
    props.toggleAriaLabel ?? ((isOpen) => (isOpen ? "Collapse section" : "Expand section"))

  const wantsBody = props.showBody ?? true
  const hasBody = wantsBody && hasRenderableChildren(props.children)
  const bodyNode = hasBody ? (
    <SectionCardBody className={props.bodyClassName ?? "p-4"}>{props.children}</SectionCardBody>
  ) : null

  return (
    <CollapsibleCard
      defaultOpen={props.defaultOpen}
      open={props.open}
      onOpenChange={props.onOpenChange}
      disableExpand={props.disableExpand}
      disableCollapse={props.disableCollapse}
      toggleAriaLabel={toggleAriaLabel}
      className={cn(
        // Match `SectionCard` base styles + existing section look.
        "min-h-0 flex-1 overflow-hidden rounded-md border",
        "flex-none text-card-foreground",
        props.className,
      )}
      header={({ open, hasBody }) => (
        <SectionCardHeader
          className={cn(!open ? "border-b-0" : undefined, !hasBody ? "border-b-0" : undefined, props.headerClassName)}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {props.icon ? <span className="shrink-0">{props.icon}</span> : null}
              <div className="min-w-0 truncate text-sm font-medium">{props.title}</div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {props.right}
              {hasBody ? (
                <ChevronDown
                  className={cn("size-4 transition-transform", open ? "rotate-180" : "")}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
        </SectionCardHeader>
      )}
      headerClassName="w-full"
    >
      {bodyNode}
    </CollapsibleCard>
  )
}

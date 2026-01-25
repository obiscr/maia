"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

type ToggleAriaLabel = string | ((open: boolean) => string)

function hasRenderableChildren(children: React.ReactNode) {
  return React.Children.count(children) > 0
}

export function CollapsibleCard(props: {
  /** Header content (render prop receives `open`) */
  header: React.ReactNode | ((ctx: { open: boolean; hasBody: boolean }) => React.ReactNode)

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
  const isControlled = props.open !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState<boolean>(props.defaultOpen ?? false)

  const open = isControlled ? Boolean(props.open) : uncontrolledOpen
  const wantsBody = props.showBody ?? true
  const hasBody = wantsBody && hasRenderableChildren(props.children)

  const triggerDisabled = !hasBody || (open ? Boolean(props.disableCollapse) : Boolean(props.disableExpand))

  const toggleAriaLabel: ToggleAriaLabel = props.toggleAriaLabel ?? ((isOpen) => (isOpen ? "Collapse" : "Expand"))

  function setOpen(next: boolean) {
    if (!hasBody) return
    if (open && !next && props.disableCollapse) return
    if (!open && next && props.disableExpand) return

    if (!isControlled) setUncontrolledOpen(next)
    props.onOpenChange?.(next)
  }

  const headerNode =
    typeof props.header === "function" ? props.header({ open, hasBody }) : (props.header as React.ReactNode)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={cn("min-h-0", props.className)}>
        {hasBody ? (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "w-full text-left",
                "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                triggerDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                props.headerClassName,
              )}
              disabled={triggerDisabled}
              aria-label={typeof toggleAriaLabel === "function" ? toggleAriaLabel(open) : toggleAriaLabel}
            >
              {headerNode}
            </button>
          </CollapsibleTrigger>
        ) : (
          <div className={props.headerClassName}>{headerNode}</div>
        )}

        {hasBody ? (
          <CollapsibleContent>
            <div className={props.bodyClassName}>{props.children}</div>
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  )
}

"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { CollapsibleCard } from "@/components/common/collapsible-card"

type SummaryProp = React.ReactNode | ((ctx: { open: boolean; hasBody: boolean }) => React.ReactNode)
type RightProp = React.ReactNode | ((ctx: { open: boolean; hasBody: boolean }) => React.ReactNode)

function resolveNodeOrFn<TCtx>(
  v: React.ReactNode | ((ctx: TCtx) => React.ReactNode) | undefined,
  ctx: TCtx,
): React.ReactNode {
  return typeof v === "function" ? v(ctx) : v
}

export function StatusCollapsibleCard(props: {
  title: React.ReactNode
  /** Optional secondary text shown next to title (e.g. error summary). */
  summary?: SummaryProp
  /** Optional right-side content (e.g. run link, duration). */
  right?: RightProp

  /** Optional details body; if provided, card becomes collapsible */
  children?: React.ReactNode

  /** Uncontrolled initial state when collapsible */
  defaultOpen?: boolean
  /** Controlled state when collapsible */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disableExpand?: boolean
  disableCollapse?: boolean
  toggleAriaLabel?: string | ((open: boolean) => string)

  className?: string
  headerClassName?: string
  bodyClassName?: string

  /** Left icon. If not provided, no icon is shown. */
  icon?: React.ReactNode
  /** Back-compat alias for icon. Prefer `icon`. */
  leftIcon?: React.ReactNode
  /** Optional className merged onto the left icon (both default and custom). */
  leftIconClassName?: string
}) {
  const leftIconNode = React.useMemo(() => {
    const node = props.icon ?? props.leftIcon ?? null
    if (!node) return null
    if (!props.leftIconClassName) return node
    if (!React.isValidElement<{ className?: string }>(node)) return node
    const prev = node.props.className
    return React.cloneElement(node, { className: cn(prev, props.leftIconClassName) })
  }, [props.icon, props.leftIcon, props.leftIconClassName])

  const header = ({ open, hasBody }: { open: boolean; hasBody: boolean }) => {
    const summaryNode = resolveNodeOrFn(props.summary, { open, hasBody })
    const rightNode = resolveNodeOrFn(props.right, { open, hasBody })

    return (
      <div className={cn("flex items-center justify-between gap-3", props.headerClassName)}>
        <div className="min-w-0 flex items-center gap-2">
          {leftIconNode ? leftIconNode : null}
          <div className="min-w-0 flex items-center gap-2">
            <div className="min-w-0 text-sm leading-5 truncate">{props.title}</div>
            {summaryNode ? <div className="min-w-0 text-sm text-muted-foreground truncate">{summaryNode}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {rightNode}
          {hasBody ? (
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", open ? "rotate-180" : "")}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <CollapsibleCard
      header={header}
      defaultOpen={props.defaultOpen}
      open={props.open}
      onOpenChange={props.onOpenChange}
      disableExpand={props.disableExpand}
      disableCollapse={props.disableCollapse}
      toggleAriaLabel={props.toggleAriaLabel}
      className={cn("w-full rounded-md border bg-background", props.className)}
      headerClassName="p-3"
      bodyClassName={cn("border-t p-3", props.bodyClassName)}
    >
      {props.children}
    </CollapsibleCard>
  )
}

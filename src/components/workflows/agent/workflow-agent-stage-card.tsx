import * as React from "react"
import { CheckCircle2, ChevronDown, Circle, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { GradientLoaderIcon } from "@/components/icons/GradientLoaderIcon"
import { Badge } from "@/components/ui/badge"
import { CollapsibleCard } from "@/components/common/collapsible-card"

export type WorkflowAgentStageStatus = "todo" | "in_progress" | "done" | "failed"

export function WorkflowAgentStageCard(props: {
  label: string
  status: WorkflowAgentStageStatus
  doneText: string
  failedText?: string
  className?: string
  /** Optional details body; if provided, card becomes collapsible */
  children?: React.ReactNode
  /** Uncontrolled initial state when collapsible */
  defaultOpen?: boolean
  /** Controlled state when collapsible */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disableExpand?: boolean
  disableCollapse?: boolean
  bodyClassName?: string
}) {
  const left = React.useMemo(() => {
    if (props.status === "done") {
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
    }
    if (props.status === "failed") {
      return <XCircle className="h-4 w-4 shrink-0 text-destructive" />
    }
    if (props.status === "in_progress") {
      return <GradientLoaderIcon className="h-4 w-4 shrink-0 animate-spin" />
    }
    return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
  }, [props.status])

  const labelClass =
    props.status === "in_progress"
      ? "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-500 bg-clip-text font-medium text-transparent"
      : props.status === "failed"
        ? "text-destructive font-medium"
        : props.status === "done"
          ? "text-muted-foreground"
          : "text-foreground"

  const hasBody = React.Children.count(props.children) > 0

  const header = ({ open }: { open: boolean; hasBody: boolean }) => (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 flex items-center gap-2">
        {left}
        <div className={cn("min-w-0 text-sm leading-5 font-medium line-clamp-1", labelClass)}>{props.label}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {props.status === "done" ? (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <CheckCircle2 className="text-muted-foreground" />
            {props.doneText}
          </Badge>
        ) : props.status === "failed" ? (
          <Badge variant="destructive" className="shrink-0 gap-1">
            <XCircle className="text-white" />
            {props.failedText ?? props.doneText}
          </Badge>
        ) : null}
        {hasBody ? (
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open ? "rotate-180" : "")}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  )

  return (
    <CollapsibleCard
      header={header}
      defaultOpen={props.defaultOpen}
      open={props.open}
      onOpenChange={props.onOpenChange}
      disableExpand={props.disableExpand}
      disableCollapse={props.disableCollapse}
      className={cn("w-full rounded-lg border bg-background shadow-sm", props.className)}
      headerClassName="px-3 py-2"
      bodyClassName={cn("border-t px-3 py-2", props.bodyClassName)}
    >
      {props.children}
    </CollapsibleCard>
  )
}

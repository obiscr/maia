"use client"

import * as React from "react"
import {
  Braces,
  CheckCircle2,
  Clock,
  Lightbulb,
  MoreVertical,
  Pencil,
  RefreshCcw,
  RotateCcw,
  ScrollText,
  Upload,
  Trash2Icon,
  ListTree,
  X,
  XCircle,
} from "lucide-react"
import { Handle, Position, type NodeProps } from "reactflow"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/components/i18n-provider"
import { formatDurationMs } from "@/lib/shared/format/time"
import { runStatusUiSpec, toCanonicalRunStatus } from "@/lib/shared/run-status"
import { GradientLoaderIcon } from "@/components/icons/GradientLoaderIcon"
import { cn } from "@/lib/utils"

export type WorkflowGraphStepNodeData = {
  stepKey: string
  name: string
  depsCount: number
  deps?: string[]
  mode: "view" | "edit"
  status?: string
  durationMs?: number | null
  highlight?: boolean
  otherFailedStepsCount?: number
  planState?: "plan" | "draft" | "complete" | "error"
  isDraftLoading?: boolean
  /** Optional: enable node right-click context menu. Default false. */
  enableContextMenu?: boolean
  onEdit?: (stepKey: string) => void
  onDelete?: (stepKey: string) => void
  onDisconnectDep?: (sourceStepKey: string, targetStepKey: string) => void
  onRetry?: (stepKey: string) => void
  onRerunStep?: (stepKey: string) => void
  onRestartFrom?: (stepKey: string) => void
  onViewStepLogs?: (stepKey: string) => void
  onViewStepOutput?: (stepKey: string) => void
  onViewStepDefinition?: (stepKey: string) => void
}

export const WorkflowGraphStepNode = React.memo(function WorkflowGraphStepNode(
  props: NodeProps<WorkflowGraphStepNodeData>,
) {
  const { t } = useI18n()
  const { stepKey, name, depsCount, mode, status, durationMs, highlight, planState, isDraftLoading } = props.data
  const isSelected = props.selected === true
  const isPlanOrDraft = planState === "plan" || planState === "draft" || planState === "error"
  const canEdit = mode === "edit" && !!props.data.onEdit && !!props.data.onDelete && !isPlanOrDraft
  const deps = Array.isArray(props.data.deps) ? props.data.deps.map(String).filter(Boolean) : []
  const canRunActions = mode === "view" && (!!props.data.onRetry || !!props.data.onRestartFrom) && !isPlanOrDraft
  const canRetry = !!props.data.onRetry && toCanonicalRunStatus(status || "") === "FAILED"
  // Product rule: "Rerun this step" should only appear for SUCCEEDED steps.
  // Failed steps should show only Retry + Restart-from.
  const canRerunStep = !!props.data.onRerunStep && toCanonicalRunStatus(status || "") === "SUCCEEDED"
  const canViewStepPanels =
    mode === "view" &&
    (!!props.data.onViewStepLogs || !!props.data.onViewStepOutput || !!props.data.onViewStepDefinition)
  const hasOtherFailedSteps = (props.data.otherFailedStepsCount ?? 0) > 0
  const statusSpec = runStatusUiSpec(status || "")
  const statusCls = statusSpec.varsClassName
  const statusText = (() => {
    const s = toCanonicalRunStatus(status || "")
    if (!s) return null
    if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
    if (s === "FAILED") return t("common.statusValues.failed")
    if (s === "RUNNING") return t("common.statusValues.running")
    if (s === "PENDING") return t("common.statusValues.queued")
    if (s === "BLOCKED") return t("runs.statusBlocked")
    if (s === "CANCELED") return t("common.statusValues.canceled")
    if (s === "SKIPPED") return t("runs.statusSkipped")
    if (s === "INTERRUPTED") return t("runs.statusInterrupted")
    return status || "—"
  })()

  const showDuration = (() => {
    if (durationMs === null || durationMs === undefined) return false
    if (!Number.isFinite(durationMs) || durationMs < 0) return false
    const s = toCanonicalRunStatus(status || "")
    // Only show after a step is "done". We treat SKIPPED/CANCELED/INTERRUPTED as done too.
    if (s === "RUNNING" || s === "PENDING" || s === "BLOCKED") return false
    return true
  })()

  const borderColor =
    // Selection styling is handled by CSS on the React Flow wrapper (`.react-flow__node-stepNode.selected`),
    // so avoid setting an inline `borderColor` that would override it.
    !isSelected
      ? highlight
        ? status
          ? "var(--maia-status-text)"
          : "hsl(var(--ring))"
        : status
          ? "var(--maia-status-border)"
          : undefined
      : undefined

  const style: React.CSSProperties = {
    ...(borderColor ? { borderColor } : null),
  }

  const enableContextMenu = props.data.enableContextMenu === true && (canEdit || canRunActions)

  const stopRfPropagation = React.useCallback((e: React.SyntheticEvent) => {
    // Prevent ReactFlow's node click handlers from firing when interacting with menu triggers.
    e.stopPropagation()
  }, [])

  const renderEditMenuContent = React.useCallback(() => {
    return (
      <DropdownMenuContent
        align="end"
        className="min-w-[180px]"
        onPointerDown={stopRfPropagation}
        onMouseDown={stopRfPropagation}
        onClick={stopRfPropagation}
      >
        <DropdownMenuItem
          onSelect={() => {
            props.data.onEdit?.(stepKey)
          }}
        >
          <Pencil className="size-4" />
          {t("common.editAction")}
        </DropdownMenuItem>

        {deps.length && props.data.onDisconnectDep ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ListTree className="size-4" />
                {t("workflows.graph.dependenciesMenu")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {deps.map((d) => (
                  <DropdownMenuItem
                    key={d}
                    className="cursor-pointer"
                    onSelect={() => {
                      props.data.onDisconnectDep?.(d, stepKey)
                    }}
                  >
                    <X className="size-4" />
                    <span>
                      {t("workflows.graph.disconnectEdgeAction")} {d}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer"
          onSelect={() => {
            props.data.onDelete?.(stepKey)
          }}
        >
          <Trash2Icon className="size-4" />
          {t("common.deleteAction")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    )
  }, [deps, props.data, stepKey, stopRfPropagation, t])

  const renderRunMenuContent = React.useCallback(() => {
    return (
      <DropdownMenuContent
        align="end"
        className="min-w-[200px]"
        onPointerDown={stopRfPropagation}
        onMouseDown={stopRfPropagation}
        onClick={stopRfPropagation}
      >
        {canViewStepPanels ? (
          <>
            {props.data.onViewStepLogs ? (
              <DropdownMenuItem
                onSelect={() => {
                  props.data.onViewStepLogs?.(stepKey)
                }}
              >
                <ScrollText className="size-4" />
                {t("runs.viewDetailsAction")}
              </DropdownMenuItem>
            ) : null}
            {props.data.onViewStepOutput ? (
              <DropdownMenuItem
                onSelect={() => {
                  props.data.onViewStepOutput?.(stepKey)
                }}
              >
                <Upload className="size-4" />
                {t("runs.viewStepOutputAction")}
              </DropdownMenuItem>
            ) : null}
            {props.data.onViewStepDefinition ? (
              <DropdownMenuItem
                onSelect={() => {
                  props.data.onViewStepDefinition?.(stepKey)
                }}
              >
                <Braces className="size-4" />
                {t("runs.viewStepDefinitionAction")}
              </DropdownMenuItem>
            ) : null}
            {canRetry || canRerunStep || props.data.onRestartFrom ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {canRetry
          ? (() => {
              const item = (
                <DropdownMenuItem
                  onSelect={() => {
                    props.data.onRetry?.(stepKey)
                  }}
                >
                  <RefreshCcw className="size-4" />
                  {t("common.retryAction")}
                </DropdownMenuItem>
              )
              if (!hasOtherFailedSteps) return item
              return (
                <Tooltip>
                  <TooltipTrigger asChild>{item}</TooltipTrigger>
                  <TooltipContent side="right" align="center" className="max-w-[320px] whitespace-pre-line">
                    {t("runs.retryHintOtherFailed")}
                  </TooltipContent>
                </Tooltip>
              )
            })()
          : null}
        {canRerunStep ? (
          <>
            {canRetry ? <DropdownMenuSeparator /> : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  onSelect={() => {
                    props.data.onRerunStep?.(stepKey)
                  }}
                >
                  <RefreshCcw className="size-4" />
                  {t("runs.rerunActionStepAction")}
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent side="right" align="center" className="max-w-[340px] whitespace-pre-line">
                <div className="space-y-1">
                  <div>{t("runs.rerunActionStepActionHint")}</div>
                  {hasOtherFailedSteps ? <div>{t("runs.rerunActionStepActionHintOtherFailed")}</div> : null}
                </div>
              </TooltipContent>
            </Tooltip>
          </>
        ) : null}
        {props.data.onRestartFrom ? (
          <>
            <DropdownMenuItem
              onSelect={() => {
                props.data.onRestartFrom?.(stepKey)
              }}
            >
              <RotateCcw className="size-4" />
              {t("runs.restartFromHereAction")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    )
  }, [canRerunStep, canRetry, canViewStepPanels, hasOtherFailedSteps, props.data, stepKey, stopRfPropagation, t])

  const renderEditContextMenu = React.useCallback(() => {
    return (
      <ContextMenuContent
        className="min-w-[200px]"
        onPointerDown={stopRfPropagation}
        onMouseDown={stopRfPropagation}
        onClick={stopRfPropagation}
      >
        <ContextMenuGroup>
          <ContextMenuItem
            onSelect={() => {
              props.data.onEdit?.(stepKey)
            }}
          >
            <Pencil className="size-4" />
            {t("common.editAction")}
          </ContextMenuItem>
        </ContextMenuGroup>

        {deps.length && props.data.onDisconnectDep ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2">
                <ListTree className="size-4" />
                {t("workflows.graph.dependenciesMenu")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent
                onPointerDown={stopRfPropagation}
                onMouseDown={stopRfPropagation}
                onClick={stopRfPropagation}
              >
                <ContextMenuGroup>
                  {deps.map((d) => (
                    <ContextMenuItem
                      key={d}
                      onSelect={() => {
                        props.data.onDisconnectDep?.(d, stepKey)
                      }}
                    >
                      <X className="size-4" />
                      <span>
                        {t("workflows.graph.disconnectEdgeAction")} {d}
                      </span>
                    </ContextMenuItem>
                  ))}
                </ContextMenuGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        ) : null}

        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              props.data.onDelete?.(stepKey)
            }}
          >
            <Trash2Icon className="size-4" />
            {t("common.deleteAction")}
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    )
  }, [deps, props.data, stepKey, t])

  const renderRunContextMenu = React.useCallback(() => {
    return (
      <ContextMenuContent onPointerDown={stopRfPropagation} onMouseDown={stopRfPropagation} onClick={stopRfPropagation}>
        {canViewStepPanels ? (
          <>
            <ContextMenuGroup>
              {props.data.onViewStepLogs ? (
                <ContextMenuItem
                  onSelect={() => {
                    props.data.onViewStepLogs?.(stepKey)
                  }}
                >
                  <ScrollText className="size-4" />
                  {t("runs.viewDetailsAction")}
                </ContextMenuItem>
              ) : null}
              {props.data.onViewStepOutput ? (
                <ContextMenuItem
                  onSelect={() => {
                    props.data.onViewStepOutput?.(stepKey)
                  }}
                >
                  <Upload className="size-4" />
                  {t("runs.viewStepOutputAction")}
                </ContextMenuItem>
              ) : null}
              {props.data.onViewStepDefinition ? (
                <ContextMenuItem
                  onSelect={() => {
                    props.data.onViewStepDefinition?.(stepKey)
                  }}
                >
                  <Braces className="size-4" />
                  {t("runs.viewStepDefinitionAction")}
                </ContextMenuItem>
              ) : null}
            </ContextMenuGroup>
            {canRetry || canRerunStep || props.data.onRestartFrom ? <ContextMenuSeparator /> : null}
          </>
        ) : null}

        <ContextMenuGroup>
          {canRetry ? (
            <ContextMenuItem
              onSelect={() => {
                props.data.onRetry?.(stepKey)
              }}
            >
              <RefreshCcw className="size-4" />
              {t("common.retryAction")}
            </ContextMenuItem>
          ) : null}
          {canRerunStep ? (
            <ContextMenuItem
              onSelect={() => {
                props.data.onRerunStep?.(stepKey)
              }}
            >
              <RefreshCcw className="size-4" />
              {t("runs.rerunActionStepAction")}
            </ContextMenuItem>
          ) : null}
          {props.data.onRestartFrom ? (
            <ContextMenuItem
              onSelect={() => {
                props.data.onRestartFrom?.(stepKey)
              }}
            >
              <RotateCcw className="size-4" />
              {t("runs.restartFromHereAction")}
            </ContextMenuItem>
          ) : null}
        </ContextMenuGroup>
      </ContextMenuContent>
    )
  }, [canRerunStep, canRetry, canViewStepPanels, props.data, stepKey, t])

  // If we re-enable tooltips for the context menu in the future, keep this to avoid unused warnings.
  void hasOtherFailedSteps

  const planBadge =
    planState === "plan"
      ? { label: t("agent.node.plan"), variant: "outline" as const, icon: Lightbulb }
      : planState === "draft"
        ? { label: t("agent.node.draft"), variant: "secondary" as const, icon: null }
        : planState === "error"
          ? { label: t("agent.node.error"), variant: "destructive" as const, icon: null }
          : null

  const nodeInner = (
    <div
      className={cn(
        "box-border w-[250px] rounded-lg bg-background p-2 shadow-none",
        isPlanOrDraft ? "border-2 border-dashed" : "border border-solid",
        statusCls,
      )}
      style={style}
    >
      {/* Handles are required for edges to render correctly on custom nodes */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-background !bg-foreground/70"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-background !bg-foreground/70"
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{name || stepKey}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {planBadge ? (
              <Badge variant={planBadge.variant} className="h-5 px-2 text-[11px]">
                <span className="inline-flex items-center gap-1">
                  {planBadge.icon ? <planBadge.icon className="h-3 w-3" aria-hidden="true" /> : null}
                  <span>{planBadge.label}</span>
                </span>
              </Badge>
            ) : null}
            <Badge variant="secondary" className="h-5 px-2 font-mono text-[11px]">
              {stepKey}
            </Badge>
            {depsCount ? (
              <Badge variant="outline" className="h-5 px-2 font-mono text-[11px]">
                deps:{depsCount}
              </Badge>
            ) : null}
            {statusText ? (
              <Badge variant="outline" className={cn("h-5 px-2 text-[11px] uppercase", "maia-status-badge", statusCls)}>
                <span className="inline-flex items-center gap-1.5">
                  {statusSpec.Icon ? (
                    <statusSpec.Icon className={cn("h-3.5 w-3.5", statusSpec.iconClassName)} aria-hidden="true" />
                  ) : null}
                  <span>{statusText}</span>
                </span>
              </Badge>
            ) : null}
            {showDuration ? (
              <Badge variant="secondary" className="h-5 px-2 font-mono text-[11px]">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{formatDurationMs(durationMs ?? null)}</span>
                </span>
              </Badge>
            ) : null}
          </div>
        </div>

        {planState === "draft" && isDraftLoading ? (
          <div className="flex items-center">
            <GradientLoaderIcon className="h-4 w-4 animate-spin will-change-transform" />
          </div>
        ) : planState === "error" ? (
          <div className="flex items-center">
            <XCircle className="h-4 w-4 text-destructive" />
          </div>
        ) : planState === "complete" ? (
          <div className="flex items-center">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
        ) : canEdit ? (
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6"
                  onPointerDown={stopRfPropagation}
                  onMouseDown={stopRfPropagation}
                  onClick={stopRfPropagation}
                >
                  <span className="sr-only">{t("common.actions")}</span>
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              {renderEditMenuContent()}
            </DropdownMenu>
          </div>
        ) : canRunActions ? (
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6"
                  onPointerDown={stopRfPropagation}
                  onMouseDown={stopRfPropagation}
                  onClick={stopRfPropagation}
                >
                  <span className="sr-only">{t("common.actions")}</span>
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              {renderRunMenuContent()}
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    </div>
  )

  return enableContextMenu ? (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenu={(e) => {
          e.stopPropagation()
        }}
      >
        {nodeInner}
      </ContextMenuTrigger>
      {canEdit ? renderEditContextMenu() : renderRunContextMenu()}
    </ContextMenu>
  ) : (
    <div
      onContextMenu={(e) => {
        e.stopPropagation()
      }}
    >
      {nodeInner}
    </div>
  )
})

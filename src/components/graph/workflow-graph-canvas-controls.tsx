"use client"

import * as React from "react"
import {
  ArrowLeftRight,
  ArrowUpDown,
  Hand,
  Maximize2,
  MousePointer2,
  Pencil,
  Trash2Icon,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/components/i18n-provider"
import type { WorkflowLayoutPresetKey } from "@/lib/client/workflow-layout-store"

export type WorkflowGraphCanvasControlsUi = {
  interactionMode: "pan" | "select"
  layoutDirection: "LR" | "TB"
  layoutPreset: WorkflowLayoutPresetKey
  showLayoutDropdown: boolean
  allowCustom: boolean
}

export function WorkflowGraphCanvasControls(props: {
  ui: WorkflowGraphCanvasControlsUi | null
  showInteraction: boolean
  showLayout: boolean
  showFit: boolean
  showZoom: boolean
  showLayoutReset: boolean
  onPan: () => void
  onSelect: () => void
  onLayoutChange: (preset: WorkflowLayoutPresetKey) => void
  onOpenReset: () => void
  onFit: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}) {
  const { t } = useI18n()

  const layoutIcon = (() => {
    if (!props.ui) return <ArrowLeftRight className="h-4 w-4" />
    if (props.ui.layoutPreset === "CUSTOM") return <Pencil className="h-4 w-4" />
    return props.ui.layoutDirection === "LR" ? (
      <ArrowLeftRight className="h-4 w-4" />
    ) : (
      <ArrowUpDown className="h-4 w-4" />
    )
  })()

  return (
    <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
      {props.showInteraction ? (
        <ButtonGroup className="shrink-0 rounded-md border bg-background">
          <Button
            variant="secondary"
            size="sm"
            className={props.ui?.interactionMode === "pan" ? "bg-muted/60" : ""}
            onClick={props.onPan}
            aria-label={t("common.graphControls.panModeAriaLabel")}
          >
            <Hand className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={props.ui?.interactionMode === "select" ? "bg-muted/60" : ""}
            onClick={props.onSelect}
            aria-label={t("common.graphControls.selectModeAriaLabel")}
          >
            <MousePointer2 className="h-4 w-4" />
          </Button>
        </ButtonGroup>
      ) : null}

      {/* Layout + Fit (grouped) */}
      {props.showLayout || props.showFit ? (
        <ButtonGroup className="shrink-0 rounded-md border bg-background">
          {props.showLayout && props.ui?.showLayoutDropdown ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" aria-label={t("workflows.layout")}>
                  {layoutIcon}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={props.ui?.layoutPreset ?? "LR"}
                  onValueChange={(v) => {
                    if (v !== "CUSTOM" && v !== "LR" && v !== "TB") return
                    props.onLayoutChange(v)
                  }}
                >
                  <DropdownMenuRadioItem value="LR">
                    <ArrowLeftRight className="size-4" />
                    {t("workflows.layoutLeftRight")}
                    <DropdownMenuShortcut>Q</DropdownMenuShortcut>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="TB">
                    <ArrowUpDown className="size-4" />
                    {t("workflows.layoutTopBottom")}
                    <DropdownMenuShortcut>W</DropdownMenuShortcut>
                  </DropdownMenuRadioItem>
                  {props.ui?.allowCustom ? (
                    <DropdownMenuRadioItem value="CUSTOM">
                      <Pencil className="size-4" />
                      {t("workflows.layoutCustom")}
                      <DropdownMenuShortcut>E</DropdownMenuShortcut>
                    </DropdownMenuRadioItem>
                  ) : null}
                </DropdownMenuRadioGroup>

                {props.showLayoutReset ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={props.onOpenReset}>
                      <Trash2Icon className="size-4" />
                      {t("workflows.layoutResetAction")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {props.showFit ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={props.onFit}
              aria-label={t("common.graphControls.fitViewAriaLabel")}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          ) : null}
        </ButtonGroup>
      ) : null}

      {/* Zoom (grouped) */}
      {props.showZoom ? (
        <ButtonGroup className="shrink-0 rounded-md border bg-background">
          <Button
            variant="secondary"
            size="sm"
            onClick={props.onZoomIn}
            aria-label={t("common.graphControls.zoomInAriaLabel")}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={props.onZoomOut}
            aria-label={t("common.graphControls.zoomOutAriaLabel")}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </ButtonGroup>
      ) : null}
    </div>
  )
}

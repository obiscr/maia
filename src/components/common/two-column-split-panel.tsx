"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

type Pane = {
  title: React.ReactNode
  content: React.ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
}

export function TwoColumnSplitPanel(props: {
  className?: string
  isMobile: boolean

  loading?: boolean
  loadingNode?: React.ReactNode

  left: Pane
  right: Pane
}) {
  const { className, isMobile, loading, loadingNode, left, right } = props

  return (
    <div className={cn("h-full min-h-0", className)}>
      {loading ? (loadingNode ?? null) : null}
      {!loading ? (
        <ResizablePanelGroup direction={isMobile ? "vertical" : "horizontal"} className="h-full min-h-0">
          <ResizablePanel defaultSize={50} minSize={20} className={cn("min-w-0", left.className)}>
            <div className="flex h-full min-h-0 flex-col">
              <div
                className={cn(
                  "shrink-0 border-b px-3 py-2 text-xs font-medium text-muted-foreground",
                  left.headerClassName,
                )}
              >
                {left.title}
              </div>
              <div className={cn("min-h-0 flex-1 overflow-hidden", left.contentClassName)}>{left.content}</div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={20} className={cn("min-w-0", right.className)}>
            <div className="flex h-full min-h-0 flex-col">
              <div
                className={cn(
                  "shrink-0 border-b px-3 py-2 text-xs font-medium text-muted-foreground",
                  right.headerClassName,
                )}
              >
                {right.title}
              </div>
              <div className={cn("min-h-0 flex-1 overflow-hidden", right.contentClassName)}>{right.content}</div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : null}
    </div>
  )
}

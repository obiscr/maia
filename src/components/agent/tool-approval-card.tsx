"use client"

import * as React from "react"
import { AlertTriangle, Check, X } from "lucide-react"

import { Button } from "@/components/ui/button"

type ToolApprovalCardProps = {
  approvalId: string
  toolLabel: string
  t: (k: string) => string
  onResponse?: (input: { id: string; approved: boolean }) => void
}

export function ToolApprovalCard(props: ToolApprovalCardProps) {
  const { approvalId, toolLabel, t, onResponse } = props
  const [choice, setChoice] = React.useState<"pending" | "approved" | "denied">("pending")

  return (
    <div className="my-2 rounded-lg border bg-muted/40 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">{t("toolCalls.approval.title")}</p>
          {toolLabel ? <p className="text-xs text-muted-foreground">{toolLabel}</p> : null}
          {choice !== "pending" ? (
            <p className="text-xs text-muted-foreground">
              {t(choice === "approved" ? "toolCalls.approval.approved" : "toolCalls.approval.denied")}
            </p>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => {
                  setChoice("approved")
                  onResponse?.({ id: approvalId, approved: true })
                }}
              >
                <Check className="h-3 w-3" />
                {t("toolCalls.approval.approveAction")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => {
                  setChoice("denied")
                  onResponse?.({ id: approvalId, approved: false })
                }}
              >
                <X className="h-3 w-3" />
                {t("toolCalls.approval.denyAction")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

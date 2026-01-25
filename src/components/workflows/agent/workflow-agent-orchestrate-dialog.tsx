"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { TFunction } from "@/lib/shared/i18n/t"
import { WorkflowsWelcomeEmpty } from "@/components/workflows/pages/workflows-welcome-empty"
import { apiFetchJson } from "@/lib/shared/http/api"

export function WorkflowAgentOrchestrateDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: TFunction
}) {
  const { open, onOpenChange, t } = props
  const router = useRouter()

  const [prompt, setPrompt] = React.useState("")
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) return
    setPrompt("")
  }, [open])

  const submit = React.useCallback(async () => {
    const text = prompt.trim()
    if (!text || pending) return
    setPending(true)
    try {
      const res = await apiFetchJson<{ agentRunId?: string }>("/api/agent-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "WORKFLOW_ORCHESTRATE",
          messages: [{ role: "user", content: text }],
        }),
      })
      const id = typeof res.agentRunId === "string" ? String(res.agentRunId) : ""
      if (!id) return
      onOpenChange(false)
      router.push(`/agent/${encodeURIComponent(id)}`)
    } finally {
      setPending(false)
    }
  }, [onOpenChange, pending, prompt, router])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>{t("workflows.aiOrchestrateAction")}</DialogTitle>
        <DialogDescription>{t("workflows.orchestrator.subtitleNew")}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="w-[calc(100vw-1.5rem)] h-[calc(100vh-1.5rem)] max-w-[calc(100vw-1.5rem)] sm:w-[calc(100vw-4rem)] sm:h-[calc(100vh-4rem)] sm:max-w-[calc(100vw-4rem)] p-0 overflow-hidden"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => promptRef.current?.focus())
        }}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <WorkflowsWelcomeEmpty
            t={t}
            prompt={prompt}
            setPrompt={setPrompt}
            promptRef={promptRef}
            onSubmit={submit}
            fullHeight={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { useI18n } from "@/components/i18n-provider"
import { AgentWelcomeEmpty } from "@/components/agent/agent-welcome-empty"
import { apiFetchJson } from "@/lib/shared/http/api"

export function AgentLandingPage() {
  const { t, locale } = useI18n()
  const router = useRouter()
  const sp = useSearchParams()
  const [prompt, setPrompt] = React.useState("")
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [pending, setPending] = React.useState(false)

  const createRun = React.useCallback(
    async (text: string) => {
      const clean = String(text ?? "").trim()
      if (!clean || pending) return
      setPending(true)
      try {
        const res = await apiFetchJson<{ agentRunId?: string }>("/api/agent-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "WORKFLOW_ORCHESTRATE",
            locale,
            messages: [{ role: "user", content: clean }],
          }),
        })
        const id = typeof res.agentRunId === "string" ? String(res.agentRunId) : ""
        if (!id) return
        router.push(`/agent/${encodeURIComponent(id)}`)
      } finally {
        setPending(false)
      }
    },
    [locale, pending, router],
  )

  const onSubmit = React.useCallback(async () => {
    const text = prompt.trim()
    if (!text || pending) return
    await createRun(text)
  }, [createRun, pending, prompt])

  // Support legacy navigation that passes `?prompt=` or sessionStorage prompt.
  const didAutoRunRef = React.useRef(false)
  React.useEffect(() => {
    if (didAutoRunRef.current) return
    if (pending) return
    const promptFromUrl = (sp.get("prompt") ?? "").trim()
    let promptFromStorage = ""
    try {
      const key = "maia.workflows.orchestrator.initialPrompt"
      const v = sessionStorage.getItem(key) ?? ""
      if (v) sessionStorage.removeItem(key)
      promptFromStorage = String(v ?? "").trim()
    } catch {
      promptFromStorage = ""
    }
    const p = (promptFromUrl || promptFromStorage).trim()
    if (!p) return
    didAutoRunRef.current = true
    setPrompt(p)
    void createRun(p)
    if (promptFromUrl) router.replace("/agent")
  }, [createRun, pending, router, sp])

  return (
    <AgentWelcomeEmpty
      t={t}
      prompt={prompt}
      setPrompt={setPrompt}
      promptRef={promptRef}
      onSubmit={onSubmit}
      pending={pending}
    />
  )
}

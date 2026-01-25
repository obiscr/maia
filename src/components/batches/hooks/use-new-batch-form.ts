"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { toast } from "@/lib/client/toast"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"

type Workflow = { id: string; name: string; hasInputSpec?: boolean }

export function useNewBatchForm(params: { t: (key: string, vars?: Record<string, any>) => string }) {
  const { t } = params
  const router = useRouter()

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [workflowId, setWorkflowId] = useState<string>("")
  const [name, setName] = useState<string>("")
  const [pinnedMode, setPinnedMode] = useState<"LATEST" | "PINNED">("LATEST")
  const [pinnedWorkflowVersionNumber, setPinnedWorkflowVersionNumber] = useState<number | null>(null)
  const [concurrencyLimit, setConcurrencyLimit] = useState<number | null>(null)
  const [rampUpSeconds, setRampUpSeconds] = useState<number | null>(null)
  const [autoMaxConcurrency, setAutoMaxConcurrency] = useState<number | null>(null)
  const [failFast, setFailFast] = useState(false)
  const [maxFailures, setMaxFailures] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const selectedWorkflow = useMemo(() => workflows.find((w) => w.id === workflowId) ?? null, [workflows, workflowId])
  const workflowHasInputSpec = selectedWorkflow?.hasInputSpec === true

  const canSubmit = !!workflowId && !submitting

  async function refreshWorkflows() {
    setLoading(true)
    try {
      const j = await apiFetchJson<{ workflows: Workflow[] }>("/api/workflows", { cache: "no-store" })
      setWorkflows(j.workflows ?? [])
      setWorkflowId((prev) => prev || j.workflows?.[0]?.id || "")
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.loadFailed" }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshWorkflows()
  }, [])

  async function createBatch(opts?: { sourceJson?: unknown }) {
    if (!canSubmit) return { started: false as const }
    const sourceJson = opts?.sourceJson ?? {}

    setSubmitting(true)
    try {
      const j = await apiFetchJson<{ batch?: { id: string } }>("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          name,
          sourceJson,
          ...(pinnedMode === "PINNED" && typeof pinnedWorkflowVersionNumber === "number"
            ? { pinnedWorkflowVersionNumber: Math.floor(pinnedWorkflowVersionNumber) }
            : {}),
          ...(typeof concurrencyLimit === "number" ? { concurrencyLimit: Math.floor(concurrencyLimit) } : {}),
          ...(typeof rampUpSeconds === "number" ? { rampUpSeconds: Math.floor(rampUpSeconds) } : {}),
          ...(typeof autoMaxConcurrency === "number" ? { autoMaxConcurrency: Math.floor(autoMaxConcurrency) } : {}),
          failFast: Boolean(failFast),
          ...(typeof maxFailures === "number" ? { maxFailures: Math.floor(maxFailures) } : {}),
        }),
      })
      toast.success(t("batches.createdToast"))
      const id = j?.batch?.id
      if (id) router.push(`/batches/${id}`)
      return { started: true as const }
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
      setSubmitting(false)
      return { started: false as const }
    }
  }

  return {
    workflows,
    workflowId,
    setWorkflowId,
    workflowHasInputSpec,
    name,
    setName,
    pinnedMode,
    setPinnedMode,
    pinnedWorkflowVersionNumber,
    setPinnedWorkflowVersionNumber,
    concurrencyLimit,
    setConcurrencyLimit,
    rampUpSeconds,
    setRampUpSeconds,
    autoMaxConcurrency,
    setAutoMaxConcurrency,
    failFast,
    setFailFast,
    maxFailures,
    setMaxFailures,
    loading,
    submitting,
    canSubmit,
    createBatch,
  }
}

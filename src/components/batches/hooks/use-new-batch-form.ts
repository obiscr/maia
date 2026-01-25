"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { toast } from "@/lib/client/toast"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { fetchWorkflowStepCount } from "@/lib/client/workflows"

type Workflow = { id: string; name: string; hasInputSpec?: boolean; stepCount?: number }

export function useNewBatchForm(params: { t: (key: string, vars?: Record<string, any>) => string }) {
  const { t } = params
  const router = useRouter()

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [workflowId, setWorkflowIdRaw] = useState<string>("")
  const [name, setName] = useState<string>("")
  const [pinnedWorkflowVersionNumber, setPinnedWorkflowVersionNumber] = useState<number | null>(null)
  const [concurrencyLimit, setConcurrencyLimit] = useState<number | null>(null)
  const [rampUpSeconds, setRampUpSeconds] = useState<number | null>(null)
  const [autoMaxConcurrency, setAutoMaxConcurrency] = useState<number | null>(null)
  const [failFast, setFailFast] = useState(false)
  const [maxFailures, setMaxFailures] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [workflowStepCount, setWorkflowStepCount] = useState<number | null>(null)
  const [workflowStepCountLoading, setWorkflowStepCountLoading] = useState(false)

  const selectedWorkflow = useMemo(() => workflows.find((w) => w.id === workflowId) ?? null, [workflows, workflowId])
  const workflowHasInputSpec = selectedWorkflow?.hasInputSpec === true

  const workflowHasSteps =
    typeof workflowStepCount === "number" && Number.isFinite(workflowStepCount) && workflowStepCount > 0
  const canSubmit = !!workflowId && !submitting && workflowHasSteps

  function setWorkflowId(next: string) {
    const nextId = String(next ?? "")
    setWorkflowIdRaw((prev) => {
      if (prev !== nextId) setPinnedWorkflowVersionNumber(null)
      return nextId
    })
  }

  useEffect(() => {
    if (!workflowId) {
      setWorkflowStepCount(null)
      setWorkflowStepCountLoading(false)
      return
    }

    // Unpinned: use list stepCount.
    if (pinnedWorkflowVersionNumber == null || !Number.isFinite(pinnedWorkflowVersionNumber)) {
      setWorkflowStepCount(
        typeof selectedWorkflow?.stepCount === "number" ? Math.max(0, selectedWorkflow.stepCount) : 0,
      )
      setWorkflowStepCountLoading(false)
      return
    }

    let cancelled = false
    setWorkflowStepCount(null)
    setWorkflowStepCountLoading(true)
    fetchWorkflowStepCount({ workflowId, pinnedWorkflowVersionNumber })
      .then((n) => {
        if (cancelled) return
        setWorkflowStepCount(Number.isFinite(n) ? Math.max(0, n) : 0)
      })
      .catch(() => {
        if (cancelled) return
        setWorkflowStepCount(null)
      })
      .finally(() => {
        if (cancelled) return
        setWorkflowStepCountLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pinnedWorkflowVersionNumber, selectedWorkflow?.stepCount, workflowId])

  async function refreshWorkflows() {
    setLoading(true)
    try {
      const j = await apiFetchJson<{ workflows: Workflow[] }>("/api/workflows", { cache: "no-store" })
      setWorkflows(j.workflows ?? [])
      setWorkflowIdRaw((prev) => prev || j.workflows?.[0]?.id || "")
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
          ...(typeof pinnedWorkflowVersionNumber === "number"
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
    workflowStepCount,
    workflowStepCountLoading,
    name,
    setName,
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

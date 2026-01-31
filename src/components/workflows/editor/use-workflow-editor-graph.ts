"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { toast } from "@/lib/client/toast"
import type { Step, Workflow } from "@/components/workflows/editor/workflow-editor-types"
import {
  validateWorkflowGraph,
  workflowGraphValidationErrorToI18nKey,
} from "@/lib/shared/maia/workflow-graph-validation"

function fingerprintSteps(steps: Step[]) {
  const normalized = (steps ?? [])
    .map((s) => ({
      stepKey: String(s.stepKey ?? ""),
      name: String(s.name ?? ""),
      description: s.description ?? null,
      scriptEsm: String(s.scriptEsm ?? ""),
      timeoutMs: typeof s.timeoutMs === "number" ? s.timeoutMs : null,
      deps: [...(s.deps ?? [])].map(String).sort(),
    }))
    .sort((a, b) => a.stepKey.localeCompare(b.stepKey))
  return JSON.stringify(normalized)
}

export function useWorkflowEditorGraph(params: {
  workflowId: string
  wf: Workflow | null
  setWf: React.Dispatch<React.SetStateAction<Workflow | null>>
  persistStepsDraft: (nextSteps: Step[], opts?: { silentToast?: boolean }) => Promise<{ ok: boolean; didSave: boolean }>
  onRequestDeleteStep?: (stepKey: string) => void
  onRequestDeleteSelectedSteps?: () => void
}) {
  const { t } = useI18n()
  const workflowId = params.workflowId
  const wf = params.wf
  const setWf = params.setWf
  const persistStepsDraft = params.persistStepsDraft
  const onRequestDeleteStep = params.onRequestDeleteStep
  const onRequestDeleteSelectedSteps = params.onRequestDeleteSelectedSteps

  const [selectedStepKey, setSelectedStepKey] = React.useState<string | null>(null)
  const [selectedGraphStepKeys, setSelectedGraphStepKeys] = React.useState<string[]>([])
  const [stepSheetOpen, setStepSheetOpen] = React.useState(false)

  // Auto-save canvas step changes (debounced). Versions are NOT created here.
  const [autoSaveState, setAutoSaveState] = React.useState<"idle" | "saving" | "error">("idle")
  const [autoSaveError, setAutoSaveError] = React.useState<string | null>(null)
  const lastPersistedFingerprintRef = React.useRef<string | null>(null)
  const latestStepsRef = React.useRef<Step[]>([])
  const timerRef = React.useRef<number | null>(null)
  const savingRef = React.useRef(false)
  const queuedRef = React.useRef(false)
  const persistRef = React.useRef(persistStepsDraft)
  const lastGraphToastRef = React.useRef<{ sig: string; at: number } | null>(null)

  React.useEffect(() => {
    persistRef.current = persistStepsDraft
  }, [persistStepsDraft])

  React.useEffect(() => {
    lastPersistedFingerprintRef.current = null
    latestStepsRef.current = []
    savingRef.current = false
    queuedRef.current = false
    setAutoSaveState("idle")
    setAutoSaveError(null)
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [workflowId])

  React.useEffect(() => {
    if (!wf) return
    latestStepsRef.current = wf.steps ?? []
    const fp = fingerprintSteps(wf.steps ?? [])
    if (lastPersistedFingerprintRef.current == null) {
      // Treat the first loaded state as persisted baseline.
      lastPersistedFingerprintRef.current = fp
      return
    }
    if (fp === lastPersistedFingerprintRef.current) return

    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(async () => {
      timerRef.current = null
      if (savingRef.current) {
        queuedRef.current = true
        return
      }
      savingRef.current = true
      setAutoSaveState("saving")
      setAutoSaveError(null)
      try {
        const steps = latestStepsRef.current ?? []
        const res = await persistRef.current(steps, { silentToast: true })
        if (res.ok && res.didSave) {
          lastPersistedFingerprintRef.current = fingerprintSteps(steps)
          setAutoSaveState("idle")
        } else if (res.ok && !res.didSave) {
          // Save was skipped (busy). Do not show an error.
          setAutoSaveState("idle")
        } else {
          setAutoSaveState("error")
          setAutoSaveError(t("errors.SAVE_FAILED"))
        }
      } finally {
        savingRef.current = false
      }
      if (queuedRef.current) queuedRef.current = false
    }, 1200)
  }, [wf?.steps, t])

  React.useEffect(() => {
    setSelectedStepKey(null)
    setSelectedGraphStepKeys([])
    setStepSheetOpen(false)
  }, [workflowId])

  const selectedStep = React.useMemo(() => {
    if (!wf || !selectedStepKey) return null
    return wf.steps.find((s) => s.stepKey === selectedStepKey) ?? null
  }, [wf, selectedStepKey])

  React.useEffect(() => {
    if (!wf) return
    setSelectedStepKey((prev) => prev ?? wf.steps?.[0]?.stepKey ?? null)
  }, [wf])

  React.useEffect(() => {
    if (!wf) return
    const byKey = new Set(wf.steps.map((s) => s.stepKey))
    setSelectedGraphStepKeys((prev) => {
      const next = prev.filter((k) => byKey.has(k))
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) return prev
      return next
    })
  }, [wf])

  const handleEditStep = React.useCallback((stepKey: string) => {
    setSelectedStepKey(stepKey)
    setStepSheetOpen(true)
  }, [])

  const handleDeleteStep = React.useCallback(
    (stepKey: string) => {
      onRequestDeleteStep?.(stepKey)
    },
    [onRequestDeleteStep],
  )

  const handleSelectedStepKeysChange = React.useCallback((stepKeys: string[]) => {
    // Selection changes can fire frequently; schedule as a low-priority update to avoid
    // blocking ReactFlow's own selection paint and causing perceived "flicker".
    React.startTransition(() => {
      setSelectedGraphStepKeys((prev) => {
        if (prev.length === stepKeys.length && prev.every((v, i) => v === stepKeys[i])) return prev
        return stepKeys
      })
    })
  }, [])

  const handleDeleteSelectedSteps = React.useCallback(() => {
    onRequestDeleteSelectedSteps?.()
  }, [onRequestDeleteSelectedSteps])

  const updateStep = React.useCallback(
    (stepKey: string, patch: Partial<Step>) => {
      setWf((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          steps: prev.steps.map((s) => {
            if (s.stepKey === stepKey) return { ...s, ...patch }
            return s
          }),
        }
      })
    },
    [setWf],
  )

  const addStep = React.useCallback(() => {
    if (!wf) return
    const base = `step_${wf.steps.length + 1}`
    let key = base
    let i = 2
    while (wf.steps.some((s) => s.stepKey === key)) key = `${base}_${i++}`
    const next: Step = {
      stepKey: key,
      name: `Step ${wf.steps.length + 1}`,
      scriptEsm:
        "export default {\n  async main(env, ctx) {\n    const { params, upstream, files, urls } = ctx;\n\n    // Write your logic here.\n    // - params: user inputs for this run\n    // - upstream: dependency outputs, shape: { [stepKey]: { ok, timestamp, data } }\n    // - convention: return { outputs: {...} } so downstream reads upstream.<stepKey>.data.outputs\n\n    return {\n      outputs: {},\n    };\n  },\n};\n",
      timeoutMs: 10 * 60 * 1000,
      deps: [],
    }
    setWf({ ...wf, steps: [...wf.steps, next] })
    setSelectedStepKey(key)
  }, [wf, setWf])

  const deleteStep = React.useCallback(
    (stepKey: string) => {
      if (!wf) return
      const deleteIdx = wf.steps.findIndex((s) => s.stepKey === stepKey)
      const remaining = wf.steps
        .filter((s) => s.stepKey !== stepKey)
        .map((s) => ({ ...s, deps: s.deps.filter((d) => d !== stepKey) }))
      setWf({ ...wf, steps: remaining })

      if (selectedStepKey !== stepKey) return
      if (!remaining.length) {
        setSelectedStepKey(null)
        return
      }
      const nextIdx = Math.min(Math.max(deleteIdx, 0), remaining.length - 1)
      setSelectedStepKey(remaining[nextIdx]?.stepKey ?? remaining[remaining.length - 1]!.stepKey)
    },
    [wf, setWf, selectedStepKey],
  )

  const deleteSteps = React.useCallback(
    (stepKeys: string[]) => {
      if (!wf) return
      const toDelete = new Set(stepKeys)
      if (!toDelete.size) return
      const remaining = wf.steps
        .filter((s) => !toDelete.has(s.stepKey))
        .map((s) => ({ ...s, deps: (s.deps ?? []).filter((d) => !toDelete.has(d)) }))
      setWf({ ...wf, steps: remaining })

      if (selectedStepKey && toDelete.has(selectedStepKey)) {
        setStepSheetOpen(false)
        setSelectedStepKey(remaining[0]?.stepKey ?? null)
      }
    },
    [wf, setWf, selectedStepKey],
  )

  const emitGraphToast = React.useCallback(
    (
      err: Parameters<typeof workflowGraphValidationErrorToI18nKey>[0],
      sourceStepKey: string,
      targetStepKey: string,
    ) => {
      const sig =
        err.code === "CYCLE" ? `CYCLE:${err.cycle.join(">")}` : `${err.code}:${targetStepKey}:${sourceStepKey}`
      const now = Date.now()
      const last = lastGraphToastRef.current
      // De-dupe: avoid repeat toasts due to dev strict-mode or rapid successive events.
      if (last && last.sig === sig && now - last.at <= 1500) return
      lastGraphToastRef.current = { sig, at: now }

      const errorKey = workflowGraphValidationErrorToI18nKey(err)
      toast.error(err.code === "CYCLE" ? `${t(errorKey)} ${err.cycle.join(" → ")}` : t(errorKey))
    },
    [t],
  )

  const connectSteps = React.useCallback(
    (sourceStepKey: string, targetStepKey: string) => {
      if (!sourceStepKey || !targetStepKey) return
      if (sourceStepKey === targetStepKey) return

      // Validate using the latest known steps first so we can show user feedback without
      // putting side-effects (toast) inside React state updaters (which may be re-invoked in dev).
      const baseline = latestStepsRef.current ?? []
      const byKey = new Set(baseline.map((s) => s.stepKey))
      if (!byKey.has(sourceStepKey) || !byKey.has(targetStepKey)) return

      const nextStepsBaseline = baseline.map((s) => {
        if (s.stepKey !== targetStepKey) return s
        const deps = s.deps ?? []
        if (deps.includes(sourceStepKey)) return s
        return { ...s, deps: [...deps, sourceStepKey] }
      })

      const graphOkBaseline = validateWorkflowGraph(nextStepsBaseline)
      if (!graphOkBaseline.ok) {
        emitGraphToast(graphOkBaseline.error, sourceStepKey, targetStepKey)
        return
      }

      // Apply via functional update to avoid flicker/races; keep updater pure (no toasts).
      setWf((prev) => {
        if (!prev) return prev
        const byKeyPrev = new Set(prev.steps.map((s) => s.stepKey))
        if (!byKeyPrev.has(sourceStepKey) || !byKeyPrev.has(targetStepKey)) return prev

        const nextSteps = prev.steps.map((s) => {
          if (s.stepKey !== targetStepKey) return s
          const deps = s.deps ?? []
          if (deps.includes(sourceStepKey)) return s
          return { ...s, deps: [...deps, sourceStepKey] }
        })

        // Re-check for safety (no side-effects here).
        const graphOk = validateWorkflowGraph(nextSteps)
        if (!graphOk.ok) return prev

        return { ...prev, steps: nextSteps }
      })
    },
    [emitGraphToast, setWf],
  )

  const disconnectSteps = React.useCallback(
    (sourceStepKey: string, targetStepKey: string) => {
      if (!wf) return
      if (!sourceStepKey || !targetStepKey) return
      if (sourceStepKey === targetStepKey) return
      setWf((prev) => {
        if (!prev) return prev
        const byKey = new Set(prev.steps.map((s) => s.stepKey))
        if (!byKey.has(sourceStepKey) || !byKey.has(targetStepKey)) return prev
        return {
          ...prev,
          steps: prev.steps.map((s) => {
            if (s.stepKey !== targetStepKey) return s
            const deps = s.deps ?? []
            if (!deps.includes(sourceStepKey)) return s
            return { ...s, deps: deps.filter((d) => d !== sourceStepKey) }
          }),
        }
      })
    },
    [wf, setWf],
  )

  const confirmDeleteStep = React.useCallback(
    async (stepKey: string): Promise<boolean> => {
      if (!wf) return false
      if (!stepKey) return false
      const deleteIdx = wf.steps.findIndex((s) => s.stepKey === stepKey)
      const remaining = wf.steps
        .filter((s) => s.stepKey !== stepKey)
        .map((s) => ({ ...s, deps: (s.deps ?? []).filter((d) => d !== stepKey) }))
      const ok = await persistStepsDraft(remaining)
      if (!ok) return false

      // Apply local state only after persistence succeeded.
      setWf({ ...wf, steps: remaining })
      setSelectedGraphStepKeys((prev) => prev.filter((k) => k !== stepKey))
      toast.success(t("workflows.stepDeletedToast"))

      if (selectedStepKey !== stepKey) return true
      if (!remaining.length) {
        setSelectedStepKey(null)
        return true
      }
      const nextIdx = Math.min(Math.max(deleteIdx, 0), remaining.length - 1)
      setSelectedStepKey(remaining[nextIdx]?.stepKey ?? remaining[remaining.length - 1]!.stepKey)
      return true
    },
    [persistStepsDraft, selectedStepKey, setWf, t, wf],
  )

  const confirmDeleteSelectedSteps = React.useCallback(async (): Promise<boolean> => {
    if (!wf) return false
    if (!selectedGraphStepKeys.length) return false

    const toDelete = new Set(selectedGraphStepKeys)
    const remaining = wf.steps
      .filter((s) => !toDelete.has(s.stepKey))
      .map((s) => ({ ...s, deps: (s.deps ?? []).filter((d) => !toDelete.has(d)) }))
    const ok = await persistStepsDraft(remaining)
    if (!ok) return false

    setWf({ ...wf, steps: remaining })
    setSelectedGraphStepKeys([])
    toast.success(t("common.stepsDeletedToast", { n: toDelete.size }))

    if (selectedStepKey && toDelete.has(selectedStepKey)) {
      setStepSheetOpen(false)
      setSelectedStepKey(remaining[0]?.stepKey ?? null)
    }
    return true
  }, [persistStepsDraft, selectedGraphStepKeys, selectedStepKey, setWf, t, wf])

  const confirmClearCanvas = React.useCallback(async (): Promise<boolean> => {
    if (!wf) return false
    if (!wf.steps.length) return false
    const ok = await persistStepsDraft([])
    if (!ok) return false
    setWf({ ...wf, steps: [] })
    setSelectedGraphStepKeys([])
    setStepSheetOpen(false)
    setSelectedStepKey(null)
    toast.success(t("workflows.canvasClearedToast"))
    return true
  }, [persistStepsDraft, setWf, t, wf])

  return {
    autoSaveState,
    autoSaveError,
    selectedStep,
    selectedStepKey,
    setSelectedStepKey,
    stepSheetOpen,
    setStepSheetOpen,
    selectedGraphStepKeys,
    setSelectedGraphStepKeys,

    handleEditStep,
    handleDeleteStep,
    handleSelectedStepKeysChange,
    handleDeleteSelectedSteps,

    updateStep,
    addStep,
    connectSteps,
    disconnectSteps,
    confirmDeleteStep,
    confirmDeleteSelectedSteps,
    confirmClearCanvas,
  }
}

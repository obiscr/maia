"use client"

import * as React from "react"
import {
  AlertCircle,
  ArrowUpRight,
  Ban,
  ChevronsDown,
  GitFork,
  Hash,
  Key,
  Package,
  RotateCcw,
  Tag,
  Trash2Icon,
} from "lucide-react"
import { useRouter } from "next/navigation"

import { useI18n } from "@/components/i18n-provider"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { HeaderActions } from "@/components/common/header-actions"
import { StandardConfirmDialog, StandardDeleteDialog } from "@/components/common/standard-confirm-dialog"
import { LoadingState } from "@/components/common/loading-state"
import { useStandardDialog } from "@/hooks/use-standard-dialog"
import { useIsMobile } from "@/hooks/use-mobile"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { runStatusUiSpec, toCanonicalRunStatus, toUiRunStatus } from "@/lib/shared/run-status"
import { runControlAvailability } from "@/lib/shared/run-control"
import { useQueryClient } from "@tanstack/react-query"

import { useRunDetail } from "@/components/runs/detail/use-run-detail"
import { RunDetailGraphPanel } from "@/components/runs/detail/run-detail-graph-panel"
import { RunDetailBottomPanel, type RunDetailBottomTab } from "@/components/runs/detail/run-detail-bottom-panel"
import { SectionCard } from "@/components/common/section-card"
import { FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { PageLoadError } from "@/components/common/page-load-error"
import { resolveRunDisplayError } from "@/lib/shared/error-display/adapters/run"
import { formatPublicIdForDisplay } from "@/lib/shared/format/id"

function statusLabel(t: (k: string, vars?: Record<string, string | number>) => string, s: string) {
  const canon = toCanonicalRunStatus(s)
  if (canon === "SUCCEEDED") return t("common.statusValues.succeeded")
  if (canon === "FAILED") return t("common.statusValues.failed")
  if (canon === "RUNNING") return t("common.statusValues.running")
  if (canon === "CANCELING") return t("common.statusValues.canceling")
  if (canon === "PENDING_INPUTS") return t("common.statusValues.queuedInputs")
  if (canon === "CANCELED") return t("common.statusValues.canceled")
  return canon || "—"
}

export default function RunDetailClient({ runId }: { runId: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const isMobile = useIsMobile()

  const detail = useRunDetail({ runId })
  const stepNameByKey = React.useMemo(() => {
    const out: Record<string, string> = {}
    for (const s of detail.steps ?? []) out[s.stepKey] = s.name
    return out
  }, [detail.steps])
  const deleteDialog = useStandardDialog()
  const cancelDialog = useStandardDialog()
  const forceStopDialog = useStandardDialog()
  const [cancelReason, setCancelReason] = React.useState("")
  const queryClient = useQueryClient()

  const [mobileViewTab, setMobileViewTab] = React.useState<"details" | "graph">("details")
  const invalidateStepCaches = React.useCallback(
    (stepKey: string) => {
      queryClient.invalidateQueries({ queryKey: ["run", runId, "step", stepKey], exact: false })
      queryClient.invalidateQueries({ queryKey: ["run", runId, "outputs"] })
      queryClient.invalidateQueries({ queryKey: ["run", runId, "artifacts"] })
    },
    [queryClient, runId],
  )
  const invalidateRunCaches = React.useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "run" && q.queryKey[1] === runId,
    })
  }, [queryClient, runId])

  const [bottomTabRequest, setBottomTabRequest] = React.useState<{ version: number; tab: RunDetailBottomTab } | null>(
    null,
  )
  const requestBottomTab = React.useCallback((tab: RunDetailBottomTab) => {
    setBottomTabRequest((prev) => ({ version: (prev?.version ?? 0) + 1, tab }))
  }, [])

  const [logFocusRequest, setLogFocusRequest] = React.useState<{
    version: number
    stepKey: string
    mode: "first_error"
  } | null>(null)
  const requestLogFocusFirstError = React.useCallback((stepKey: string) => {
    setLogFocusRequest((prev) => ({ version: (prev?.version ?? 0) + 1, stepKey, mode: "first_error" }))
  }, [])

  const jumpToStep = React.useCallback(
    (stepKey: string, opts?: { tab?: RunDetailBottomTab }) => {
      detail.setFollowProgress(false)
      detail.setSelectedStepKey(stepKey)
      if (opts?.tab) requestBottomTab(opts.tab)
    },
    [detail, requestBottomTab],
  )

  const openStepPanelFromGraph = React.useCallback(
    (stepKey: string, tab: RunDetailBottomTab) => {
      const anchorId = "run-detail-bottom-panel-anchor"
      const doScroll = () => {
        const el = document.getElementById(anchorId)
        el?.scrollIntoView({ behavior: "smooth", block: "start" })
      }

      // Ensure the details tab is active on mobile.
      if (isMobile && mobileViewTab !== "details") {
        setMobileViewTab("details")
        setTimeout(doScroll, 80)
      } else {
        doScroll()
      }

      jumpToStep(stepKey, { tab })
    },
    [isMobile, jumpToStep, mobileViewTab],
  )

  const focusBottomPanel = React.useCallback(() => {
    const anchorId = "run-detail-bottom-panel-anchor"
    const doScroll = () => {
      const el = document.getElementById(anchorId)
      el?.scrollIntoView({ behavior: "smooth", block: "start" })
    }

    // Ensure the details tab is active on mobile.
    if (isMobile && mobileViewTab !== "details") {
      setMobileViewTab("details")
      setTimeout(doScroll, 80)
    } else {
      doScroll()
    }

    // Pick a sensible default tab based on run status.
    const canon = toCanonicalRunStatus(String(detail.runCanonicalStatus ?? ""))
    if (canon === "PENDING_INPUTS") {
      requestBottomTab("runInputs")
      return
    }
    if (canon === "SUCCEEDED") {
      requestBottomTab("artifacts")
      return
    }
    if (canon === "FAILED") {
      const failedStepKey =
        (detail.steps ?? []).find((s) => toCanonicalRunStatus(String(s.status ?? "")) === "FAILED")?.stepKey ?? null
      if (failedStepKey) {
        jumpToStep(String(failedStepKey), { tab: "logs" })
        requestLogFocusFirstError(String(failedStepKey))
        return
      }
    }
    requestBottomTab("logs")
  }, [
    detail.runCanonicalStatus,
    detail.steps,
    isMobile,
    jumpToStep,
    mobileViewTab,
    requestBottomTab,
    requestLogFocusFirstError,
  ])

  async function deleteRun(): Promise<boolean> {
    try {
      await apiFetchJson(`/api/runs/${runId}`, { method: "DELETE" })
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.deleteActionFailed" }))
      return false
    }
    toast.success(t("runs.deletedToast"))
    router.replace("/runs")
    return true
  }

  async function cancelRun(): Promise<boolean> {
    try {
      const reason = cancelReason.trim()
      await apiFetchJson(`/api/runs/${runId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      })
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "runs.cancelFailed" }))
      return false
    }
    toast.success(t("runs.canceledToast"))
    await detail.refresh({ preserveSelection: true })
    return true
  }

  const retryStep = React.useCallback(
    async (stepKey: string) => {
      try {
        await apiFetchJson(`/api/runs/${runId}/steps/${stepKey}/retry`, { method: "POST" })
      } catch (e) {
        toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
        return
      }
      toast.info(t("runs.stepRetryQueuedToast"))
      invalidateStepCaches(stepKey)
      await detail.refresh({ preserveSelection: true })
    },
    [detail, invalidateStepCaches, runId, t],
  )

  const rerunStep = React.useCallback(
    async (stepKey: string) => {
      try {
        const res = await apiFetchJson<{ newRunId?: string }>(`/api/runs/${runId}/steps/${stepKey}/rerun`, {
          method: "POST",
        })
        const newRunId = typeof res?.newRunId === "string" ? res.newRunId : ""
        if (newRunId && newRunId !== runId) {
          toast.info(t("runs.stepRerunQueuedToast"))
          router.replace(`/runs/${newRunId}`)
          return
        }
      } catch (e) {
        toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
        return
      }
      toast.info(t("runs.stepRerunQueuedToast"))
      invalidateStepCaches(stepKey)
      await detail.refresh({ preserveSelection: true })
    },
    [detail, invalidateStepCaches, runId, router, t],
  )

  const restartFrom = React.useCallback(
    async (stepKey: string) => {
      try {
        const res = await apiFetchJson<{ newRunId?: string }>(`/api/runs/${runId}/steps/${stepKey}/restart`, {
          method: "POST",
        })
        const newRunId = typeof res?.newRunId === "string" ? res.newRunId : ""
        if (newRunId && newRunId !== runId) {
          toast.info(t("runs.restartFromQueuedToast"))
          router.replace(`/runs/${newRunId}`)
          return
        }
      } catch (e) {
        toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
        return
      }
      toast.info(t("runs.restartFromQueuedToast"))
      detail.stream.setLogs({})
      invalidateRunCaches()
      await detail.refresh({ preserveSelection: true })
    },
    [detail, invalidateRunCaches, runId, router, t],
  )

  const forkLabel = React.useMemo(() => {
    const kind = String(detail.run?.forkKind ?? "").toLowerCase()
    const stepKey = String(detail.run?.forkStepKey ?? "")
    if (kind === "rerun_step") return stepKey ? `rerun ${stepKey}` : "rerun"
    if (kind === "restart_from_step") return stepKey ? `restart ${stepKey}` : "restart"
    return "fork"
  }, [detail.run])

  const runViewForMeta = detail.effectiveRun ?? detail.run
  const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
  const reservedKeysMeta = React.useMemo(() => {
    const keys = Array.isArray(runViewForMeta?.reservedInitialInputKeys)
      ? runViewForMeta?.reservedInitialInputKeys?.filter((x) => typeof x === "string" && String(x).trim())
      : []
    const uniq = Array.from(new Set(keys.map((x) => String(x).trim()))).sort((a, b) => a.localeCompare(b))
    return { keys: uniq, count: uniq.length }
  }, [runViewForMeta?.reservedInitialInputKeys])
  const snapshotMeta = React.useMemo(() => {
    const raw = runViewForMeta?.workflowSnap
    if (typeof raw !== "string" || !raw)
      return { depsHash: null as string | null, depsPackagesCount: null as number | null }
    try {
      const snap = JSON.parse(raw)
      if (!isRecord(snap)) {
        return { depsHash: null as string | null, depsPackagesCount: null as number | null }
      }
      const depsHash = typeof snap?.depsHash === "string" ? String(snap.depsHash) : null
      const depsPackagesCount = (() => {
        const depsRaw = typeof snap?.dependencies === "string" ? String(snap.dependencies) : ""
        if (!depsRaw) return null
        try {
          const parsed = JSON.parse(depsRaw)
          if (!isRecord(parsed)) return null
          return Object.keys(parsed as Record<string, unknown>).length
        } catch {
          return null
        }
      })()
      return { depsHash, depsPackagesCount }
    } catch {
      return { depsHash: null as string | null, depsPackagesCount: null as number | null }
    }
  }, [runViewForMeta?.workflowSnap])

  // IMPORTANT: Hooks must stay above any conditional returns (Rules of Hooks).
  // Derive failure display info even when `detail.run` is not ready yet.
  const runFailure = React.useMemo(() => {
    const rv = detail.effectiveRun ?? detail.run
    return resolveRunDisplayError({
      failureCode: rv?.failureCode ?? null,
      failureMessage: rv?.failureMessage ?? null,
      failureMetaJson: rv?.failureMetaJson ?? null,
    })
  }, [
    detail.effectiveRun?.failureCode,
    detail.effectiveRun?.failureMessage,
    detail.effectiveRun?.failureMetaJson,
    detail.run?.failureCode,
    detail.run?.failureMessage,
    detail.run?.failureMetaJson,
  ])

  if (!detail.run) {
    if (detail.error && !detail.loading) {
      return (
        <PageLoadError
          error={detail.error}
          onRetry={() => void detail.refresh()}
          backHref="/runs"
          backLabelKey="nav.runs"
        />
      )
    }
    return <LoadingState textKey="common.loading" spinner placement="top" minHeightClassName="min-h-[40vh]" />
  }

  const runView = detail.effectiveRun ?? detail.run
  const ctl = runControlAvailability({
    canonicalStatus: detail.runCanonicalStatus,
    cancelRequestedAtIso: runView.cancelRequestedAt ?? null,
  })
  const isCanceling = ctl.isCanceling
  const uiRunStatus = toUiRunStatus(runView.status, runView.cancelRequestedAt)
  const statusSpec = runStatusUiSpec(uiRunStatus)
  const statusText = statusLabel(t, uiRunStatus)
  const hasWorkflowVersion = typeof runView.workflowVersionNumber === "number"
  const showForceStop = ctl.showForceStop

  const modalsNode = (
    <>
      <StandardDeleteDialog
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        title={t("runs.deleteRunTitle")}
        description={t("runs.deleteRunDescription")}
        onConfirm={async () => {
          await deleteDialog.confirm(deleteRun)
        }}
        pending={deleteDialog.pending}
      />
      <StandardConfirmDialog
        open={cancelDialog.open}
        onOpenChange={cancelDialog.onOpenChange}
        title={t("runs.cancelRunTitle")}
        description={
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">{t("runs.cancelRunDescription")}</div>
            <div className="grid gap-2">
              <FieldLabel htmlFor="run-cancel-reason">{t("runs.cancelReasonLabel")}</FieldLabel>
              <Input
                id="run-cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t("runs.cancelReasonPlaceholder")}
                maxLength={200}
              />
              <FieldDescription className="text-xs">{t("runs.cancelReasonHint")}</FieldDescription>
            </div>
          </div>
        }
        confirmText={t("runs.cancelRunAction")}
        confirmVariant="destructive"
        confirmIcon={<Ban className="h-4 w-4" aria-hidden="true" />}
        onConfirm={async () => {
          await cancelDialog.confirm(cancelRun)
        }}
        pending={cancelDialog.pending}
      />
      <StandardConfirmDialog
        open={forceStopDialog.open}
        onOpenChange={forceStopDialog.onOpenChange}
        title={t("runs.forceStopTitle")}
        description={t("runs.forceStopDescription")}
        confirmText={t("runs.forceStopAction")}
        confirmVariant="destructive"
        confirmIcon={<Ban className="h-4 w-4" aria-hidden="true" />}
        onConfirm={async () => {
          await forceStopDialog.confirm(async () => {
            try {
              await apiFetchJson(`/api/runs/${runId}/force-stop`, { method: "POST" })
            } catch (e) {
              toast.error(tApiError({ t, err: e, fallbackKey: "runs.forceStopFailed" }))
              return false
            }
            toast.success(t("runs.forceStopToast"))
            await detail.refresh({ preserveSelection: true })
            return true
          })
        }}
        pending={forceStopDialog.pending}
      />
    </>
  )

  return (
    <DetailPageLayout
      variant={isMobile ? "fill" : "stack"}
      modals={modalsNode}
      header={
        <StandardPageHeader
          title={
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={["inline-flex shrink-0 items-center", statusSpec.varsClassName, statusSpec.textClassName]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={statusText}
                title={statusText}
              >
                {statusSpec.Icon ? (
                  <statusSpec.Icon
                    aria-hidden="true"
                    className={["size-5", statusSpec.iconClassName].filter(Boolean).join(" ")}
                  />
                ) : (
                  <AlertCircle aria-hidden="true" className="size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1 truncate">{runView.workflowName}</div>
            </div>
          }
          description={
            <InlineItemRow
              useBadge={true}
              wrap={true}
              iconSizeClassName="size-3.5"
              defaultVariant="secondary"
              items={[
                ...(runView.forkedFromRunId
                  ? [
                      {
                        key: "forkedFrom",
                        text: formatPublicIdForDisplay(String(runView.forkedFromRunId)),
                        Icon: GitFork,
                        badgeClassName: "h-6 font-mono text-xs",
                        textClassName: "text-xs",
                        title: `forked from ${formatPublicIdForDisplay(String(runView.forkedFromRunId))} (${forkLabel})`,
                        onClick: () => router.push(`/runs/${encodeURIComponent(String(runView.forkedFromRunId))}`),
                      },
                    ]
                  : []),
                ...(typeof runView.workflowVersionNumber === "number"
                  ? [
                      {
                        key: "workflowVersion",
                        text: `v${String(runView.workflowVersionNumber)}`,
                        Icon: Tag,
                        badgeClassName: "h-6 font-mono text-xs",
                        textClassName: "text-xs",
                      },
                    ]
                  : []),
                ...(typeof snapshotMeta.depsPackagesCount === "number"
                  ? [
                      {
                        key: "depsPackagesCount",
                        text: String(t("runs.depsPackagesCount", { n: snapshotMeta.depsPackagesCount })),
                        Icon: Package,
                        badgeClassName: "h-6 font-mono text-xs",
                        textClassName: "text-xs",
                      },
                    ]
                  : []),
                ...(snapshotMeta.depsHash
                  ? [
                      {
                        key: "depsHash",
                        text: `${t("runs.depsHash")}:${String(snapshotMeta.depsHash).slice(0, 8)}`,
                        Icon: Hash,
                        badgeClassName: "h-6 font-mono text-xs",
                        textClassName: "text-xs",
                        tooltip: String(snapshotMeta.depsHash),
                      },
                    ]
                  : []),
                ...(reservedKeysMeta.count
                  ? [
                      {
                        key: "reservedInitialInputKeys",
                        text: String(t("runs.reservedInitialInputKeysCount", { n: reservedKeysMeta.count })),
                        Icon: Key,
                        badgeClassName: "h-6 font-mono text-xs",
                        textClassName: "text-xs",
                        tooltip: reservedKeysMeta.keys.join(", "),
                      },
                    ]
                  : []),
                ...(detail.runCanonicalStatus === "FAILED" &&
                (runFailure.displayCode || runFailure.wrapperCode || runFailure.wrapperMessage)
                  ? [
                      {
                        key: "failure",
                        text: String(runFailure.displayCode ?? runFailure.wrapperCode ?? "UNKNOWN"),
                        Icon: AlertCircle,
                        badgeClassName: "h-6 font-mono text-xs text-destructive",
                        textClassName: "text-xs text-destructive",
                        onClick: focusBottomPanel,
                        tooltip:
                          runFailure.wrapperCode && runFailure.wrapperCode !== runFailure.displayCode
                            ? `${runFailure.wrapperCode}${runFailure.wrapperMessage ? `: ${runFailure.wrapperMessage}` : ""}`
                            : (runFailure.wrapperMessage ?? runFailure.wrapperCode ?? undefined),
                      },
                    ]
                  : []),
              ]}
            />
          }
          right={
            <HeaderActions
              iconOnlyBelow="md"
              overflow
              overflowAlign="end"
              sections={[
                {
                  key: "main",
                  items: [
                    {
                      key: "open-workflow",
                      label: hasWorkflowVersion ? t("runs.viewSnapshotAction") : t("common.openActionWorkflowAction"),
                      icon: <ArrowUpRight className="size-4" aria-hidden="true" />,
                      href: hasWorkflowVersion
                        ? `/workflows/${runView.workflowId}/versions/${encodeURIComponent(String(runView.workflowVersionNumber))}`
                        : `/workflows/${runView.workflowId}`,
                      newTab: hasWorkflowVersion,
                      pinned: true,
                    },
                    ...(["RUNNING", "PENDING_INPUTS"].includes(detail.runCanonicalStatus)
                      ? [
                          {
                            key: "cancel",
                            label: t("runs.cancelRunAction"),
                            icon: <Ban className="size-4" aria-hidden="true" />,
                            onClick: () => cancelDialog.openDialog(),
                            variant: "destructive" as const,
                            menuVariant: "destructive" as const,
                            overflowOnly: true,
                            disabled: cancelDialog.pending || isCanceling,
                          },
                        ]
                      : []),
                    ...(showForceStop
                      ? [
                          {
                            key: "force-stop",
                            label: t("runs.forceStopAction"),
                            icon: <Ban className="size-4" aria-hidden="true" />,
                            onClick: () => forceStopDialog.openDialog(),
                            variant: "destructive" as const,
                            menuVariant: "destructive" as const,
                            overflowOnly: true,
                            disabled: forceStopDialog.pending,
                          },
                        ]
                      : []),
                    ...(detail.showSummaryAction
                      ? [
                          {
                            key: "focus-details",
                            label:
                              detail.runCanonicalStatus === "RUNNING"
                                ? t("runs.viewProgressAction")
                                : t("runs.viewDetailsAction"),
                            icon: <ChevronsDown className="size-4" aria-hidden="true" />,
                            onClick: focusBottomPanel,
                            pinned: true,
                            variant: "secondary" as const,
                          },
                        ]
                      : []),
                    {
                      key: "rerun",
                      label: t("runs.rerunAction"),
                      icon: <RotateCcw className="size-4" aria-hidden="true" />,
                      href: `/jobs?action=new&fromRunId=${encodeURIComponent(runView.id)}`,
                      overflowOnly: true,
                    },
                    {
                      key: "delete",
                      label: t("common.deleteAction"),
                      icon: <Trash2Icon className="size-4" aria-hidden="true" />,
                      onClick: () => deleteDialog.openDialog(),
                      overflowOnly: true,
                      disabled: deleteDialog.pending,
                      menuVariant: "destructive",
                    },
                  ],
                },
              ]}
            />
          }
        />
      }
      bodyClassName={isMobile ? "min-h-0 flex-1 overflow-hidden" : undefined}
    >
      {/* Desktop: split view (graph + details). Mobile: segmented switch (Details / Graph). */}
      <div className={isMobile ? "min-h-0 flex-1 overflow-hidden" : "grid min-w-0 gap-2"}>
        {isMobile ? (
          <Tabs
            value={mobileViewTab}
            onValueChange={(v) => {
              if (v === "details" || v === "graph") setMobileViewTab(v)
            }}
            className="flex h-full min-h-0 flex-col gap-3"
          >
            <div className="shrink-0">
              <TabsList className="w-full">
                <TabsTrigger value="details" className="flex-1">
                  {t("common.tabs.details")}
                </TabsTrigger>
                <TabsTrigger value="graph" className="flex-1">
                  {t("common.tabs.graph")}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="graph" className="min-h-0 flex-1">
              <SectionCard className="h-full min-h-0 overflow-hidden text-card-foreground">
                <RunDetailGraphPanel
                  className="h-full"
                  steps={detail.graphSteps}
                  runStatus={uiRunStatus}
                  runDurationMs={detail.runDurationMs}
                  followProgress={detail.followProgress}
                  onToggleFollow={() => detail.setFollowProgress((v) => !v)}
                  stepStatusByKey={detail.stepStatusByKey}
                  stepDurationMsByKey={detail.stepDurationMsByKey}
                  highlightStepKeys={detail.highlightStepKeys}
                  selectedStepKey={detail.selectedStepKey}
                  onSelectStepKey={(k) => {
                    detail.setFollowProgress(false)
                    detail.setSelectedStepKey(k)
                  }}
                  onViewStepLogs={(k) => openStepPanelFromGraph(k, "logs")}
                  onViewStepOutput={(k) => openStepPanelFromGraph(k, "stepOutput")}
                  onViewStepDefinition={(k) => openStepPanelFromGraph(k, "stepDefinition")}
                  onRetryStep={(k) => {
                    detail.setFollowProgress(false)
                    detail.setSelectedStepKey(k)
                    void retryStep(k)
                  }}
                  onRerunStep={(k) => {
                    detail.setFollowProgress(false)
                    detail.setSelectedStepKey(k)
                    void rerunStep(k)
                  }}
                  onRestartFromStep={(k) => {
                    detail.setFollowProgress(false)
                    detail.setSelectedStepKey(k)
                    void restartFrom(k)
                  }}
                />
              </SectionCard>
            </TabsContent>

            <TabsContent value="details" className="min-h-0 flex-1">
              <div id="run-detail-bottom-panel-anchor" />
              <RunDetailBottomPanel
                className="flex h-full min-h-0 flex-col"
                runId={runId}
                selectedStepKey={detail.selectedStepKey}
                selectedStepName={detail.selectedStep?.name ?? null}
                stepNameByKey={stepNameByKey}
                stream={detail.stream}
                effectiveRunStatus={uiRunStatus}
                tabRequest={bottomTabRequest}
                logFocusRequest={logFocusRequest}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            {/* Top: graph (fixed height) */}
            <SectionCard className="h-[600px] min-w-0 overflow-hidden text-card-foreground">
              <RunDetailGraphPanel
                className="h-full"
                steps={detail.graphSteps}
                runStatus={runView.status}
                runDurationMs={detail.runDurationMs}
                followProgress={detail.followProgress}
                onToggleFollow={() => detail.setFollowProgress((v) => !v)}
                stepStatusByKey={detail.stepStatusByKey}
                stepDurationMsByKey={detail.stepDurationMsByKey}
                highlightStepKeys={detail.highlightStepKeys}
                selectedStepKey={detail.selectedStepKey}
                onSelectStepKey={(k) => {
                  detail.setFollowProgress(false)
                  detail.setSelectedStepKey(k)
                }}
                onViewStepLogs={(k) => openStepPanelFromGraph(k, "logs")}
                onViewStepOutput={(k) => openStepPanelFromGraph(k, "stepOutput")}
                onViewStepDefinition={(k) => openStepPanelFromGraph(k, "stepDefinition")}
                onRetryStep={(k) => {
                  detail.setFollowProgress(false)
                  detail.setSelectedStepKey(k)
                  void retryStep(k)
                }}
                onRerunStep={(k) => {
                  detail.setFollowProgress(false)
                  detail.setSelectedStepKey(k)
                  void rerunStep(k)
                }}
                onRestartFromStep={(k) => {
                  detail.setFollowProgress(false)
                  detail.setSelectedStepKey(k)
                  void restartFrom(k)
                }}
              />
            </SectionCard>

            {/* Bottom: details (fixed height) */}
            <div id="run-detail-bottom-panel-anchor" />
            <RunDetailBottomPanel
              className="h-[600px] min-w-0"
              runId={runId}
              selectedStepKey={detail.selectedStepKey}
              selectedStepName={detail.selectedStep?.name ?? null}
              stepNameByKey={stepNameByKey}
              stream={detail.stream}
              effectiveRunStatus={uiRunStatus}
              tabRequest={bottomTabRequest}
              logFocusRequest={logFocusRequest}
            />
          </>
        )}
      </div>
    </DetailPageLayout>
  )
}

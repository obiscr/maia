"use client"

import * as React from "react"
import {
  AlertCircle,
  BarChart3,
  Boxes,
  Braces,
  Circle,
  Clock,
  Clock3,
  Download,
  Hash,
  History,
  Inbox,
  ListTree,
  MoreHorizontal,
  RotateCcw,
  ScrollText,
  Upload,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { JsonViewer } from "@/components/common/json-viewer"
import { LogViewer } from "@/components/common/log-viewer"
import { FileViewer } from "@/components/common/file-viewer"
import { CodeViewer } from "@/components/common/code-viewer"
import { SectionCard, SectionCardBody, SectionCardFooter } from "@/components/common/section-card"
import { Button } from "@/components/ui/button"
import {
  calcDurationMs,
  formatAbsoluteTimeTitle,
  formatDurationMs,
  formatRelativeTimeFromNow,
} from "@/lib/shared/format/time"
import { toCanonicalRunStatus } from "@/lib/shared/run-status"
import { StepOrAttemptStatusBadge } from "@/components/runs/detail/run-status-badges"
import { formatRunStepErrorDetails, type RunStepErrorCode, type RunStepErrorMeta } from "@/lib/shared/run-errors"
import { cn } from "@/lib/utils"
import { isRecord } from "@/lib/shared/lang/is-record"
import { useRunDetailBottomPanelData } from "@/components/runs/detail/use-run-detail-bottom-panel"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { useIsMobile } from "@/hooks/use-mobile"
import { TwoColumnSplitPanel } from "@/components/common/two-column-split-panel"
import { TwoColumnSplitPanelSkeleton } from "@/components/common/two-column-split-panel-skeletons"
import { StatusCollapsibleCard } from "@/components/common/status-collapsible-card"
import { KeyValueGrid } from "@/components/common/key-value-grid"
import { resolveAttemptDisplayError } from "@/lib/shared/error-display/adapters/attempt"
import { useTimezone } from "@/components/timezone-provider"
import {
  StepAttemptsSkeleton,
  StepDefinitionSkeleton,
  StepLogsSkeleton,
} from "@/components/runs/detail/run-detail-bottom-panel-skeletons"
import { jobAttemptStatusUiSpec } from "@/lib/shared/job-status"

export type RunDetailBottomTab =
  | "artifacts"
  | "runInputs"
  | "logs"
  | "stepInput"
  | "stepOutput"
  | "stepDefinition"
  | "attempts"

type RunLevelTab = "runInputs" | "artifacts" | "step" | "summary"
type StepLevelTab = "logs" | "stepInput" | "stepOutput" | "stepDefinition" | "attempts"

const RUN_STEP_ERROR_CODE_SET = new Set<RunStepErrorCode>([
  "STEP_TIMEOUT",
  "STEP_SIGNAL",
  "STEP_EXIT_CODE",
  "OUTPUT_MISSING",
  "OUTPUT_INVALID",
  "UNKNOWN",
])

function parseRunStepErrorCode(value: unknown): RunStepErrorCode {
  if (typeof value !== "string") return "UNKNOWN"
  const v = String(value) as RunStepErrorCode
  return RUN_STEP_ERROR_CODE_SET.has(v) ? v : "UNKNOWN"
}

export function RunDetailBottomPanel(props: {
  className?: string
  runId: string
  selectedStepKey: string | null
  selectedStepName: string | null
  stepNameByKey?: Record<string, string>

  stream: {
    selectedLogs: (stepKey: string | null) => unknown[]
    stepStatusByKey: Record<string, { status: string; attemptNo?: number }>
  }
  effectiveRunStatus: string

  tabRequest?: { version: number; tab: RunDetailBottomTab } | null
  logFocusRequest?: { version: number; stepKey: string; mode: "first_error" } | null
}) {
  const { t, locale, tErrorCode } = useI18n()
  const { effectiveTimezone } = useTimezone()
  const router = useRouter()
  const isMobile = useIsMobile()

  const errorTextFromCode = React.useCallback(
    (code: string | null | undefined) => {
      const c = typeof code === "string" ? code.trim() : ""
      if (!c) return null
      return tErrorCode(c) ?? c
    },
    [tErrorCode],
  )

  const [runTab, setRunTab] = React.useState<RunLevelTab>(() => {
    const canon = toCanonicalRunStatus(String(props.effectiveRunStatus ?? ""))
    if (canon === "PENDING_INPUTS") return "runInputs"
    if (canon === "SUCCEEDED") return "artifacts"
    return "step"
  })
  const [stepTab, setStepTab] = React.useState<StepLevelTab>("logs")

  const lastTabReqRef = React.useRef<number>(props.tabRequest?.version ?? 0)
  React.useEffect(() => {
    const v = props.tabRequest?.version ?? 0
    if (!v) return
    if (v === lastTabReqRef.current) return
    lastTabReqRef.current = v
    const tab = props.tabRequest?.tab ?? null
    if (!tab) return
    if (tab === "artifacts") {
      setRunTab("artifacts")
      return
    }
    if (tab === "runInputs") {
      setRunTab("runInputs")
      return
    }
    setRunTab("step")
    setStepTab(tab as StepLevelTab)
  }, [props.tabRequest])

  const bottomTabHint = React.useMemo(() => {
    if (runTab === "summary") return t("runs.summaryHint")
    if (runTab === "artifacts") return t("runs.artifactsHint")
    if (runTab === "runInputs") return t("common.inputsHint")
    switch (stepTab) {
      case "logs":
        return t("runs.logsHint")
      case "stepInput":
        return t("runs.stepInputHint")
      case "stepOutput":
        return t("runs.stepOutputHint")
      case "stepDefinition":
        return t("runs.stepDefinitionHint")
      case "attempts":
        return t("runs.runHistoryHint")
      default:
        return ""
    }
  }, [runTab, stepTab, t])

  const stepStats = React.useMemo(() => {
    const out: Record<string, number> = {}
    const values = Object.values(props.stream.stepStatusByKey ?? {})
    for (const v of values) {
      const s = toCanonicalRunStatus(String(v?.status ?? ""))
      out[s] = (out[s] ?? 0) + 1
    }
    return out
  }, [props.stream.stepStatusByKey])

  const data = useRunDetailBottomPanelData({
    runId: props.runId,
    selectedStepKey: props.selectedStepKey,
    effectiveRunStatus: props.effectiveRunStatus,
    stream: props.stream,
    runTab,
    stepTab,
    fileFallbackName: t("runs.file"),
    stepNameByKey: props.stepNameByKey,
    artifactKindLabelByKind: {
      input: t("runs.input"),
      output: t("runs.output"),
      file: t("runs.file"),
    },
    formatAttemptShort: (attemptNo: number) => t("runs.attemptShort", { attemptNo }),
  })

  const {
    runOutputs,
    runOutputsLoaded,
    artifactsLoaded,
    deliverableArtifactViewerFiles,
    artifactsLoading,

    initialInputCode,
    hasInitialParams,
    initialInputParams,
    fileViewerFiles,
    runInputsLoading,

    stepDefByStepKey,
    stepDefLoadingByStepKey,
    selectedStepDef,
    stepDefinitionLoading,

    inputJson,
    inputJsonLoaded,
    inputJsonCode,
    outputJson,
    outputJsonLoaded,
    outputJsonCode,
    stepInputLoading,
    stepOutputLoading,

    stepInputArtifactViewerFiles,
    stepOutputArtifactViewerFiles,
    stepArtifactsLoaded,
    stepArtifactsLoading,

    attemptsByStepKey,
    attemptsLoading,
    selectedStepStatus,
  } = data

  const selectedLogs = React.useMemo(
    () => props.stream.selectedLogs(props.selectedStepKey),
    [props.stream, props.selectedStepKey],
  )
  const logViewerLines = React.useMemo(() => {
    return selectedLogs.map((l: unknown) => {
      const rec = l && typeof l === "object" ? (l as Record<string, unknown>) : null
      const kind = typeof rec?.kind === "string" ? String(rec.kind) : ""
      if (kind === "step_error") {
        const code = parseRunStepErrorCode(rec?.code)
        const meta = (rec?.meta ?? null) as RunStepErrorMeta | null
        const timeoutMs = meta?.timeoutMs != null ? Number(meta.timeoutMs) : null
        const duration = timeoutMs != null ? formatDurationMs(timeoutMs) : "—"
        let summary = t("runs.stepError.summaryUnknown")
        switch (code) {
          case "STEP_TIMEOUT": {
            summary = t("runs.stepError.summaryTimeout", { duration })
            break
          }
          case "STEP_SIGNAL": {
            summary = t("runs.stepError.summarySignal", { signal: meta?.signal ?? "—" })
            break
          }
          case "STEP_EXIT_CODE": {
            summary = t("runs.stepError.summaryExitCode", { code: meta?.exitCode ?? "—" })
            break
          }
          case "OUTPUT_MISSING": {
            summary = t("runs.stepError.summaryOutputMissing")
            break
          }
          case "OUTPUT_INVALID": {
            summary = t("runs.stepError.summaryOutputInvalid", {
              reason: meta?.outputParseError ?? t("runs.stepError.reasonUnknown"),
            })
            break
          }
          case "UNKNOWN":
          default: {
            summary = t("runs.stepError.summaryUnknown")
            break
          }
        }
        const details = formatRunStepErrorDetails(meta)
        const detailPart = details
          ? t("runs.stepError.detailsSuffix", { label: t("runs.stepError.detailsLabel"), details })
          : ""
        const codePart = t("runs.stepError.codeSuffix", { code })
        return {
          ts: rec?.ts ? String(rec.ts) : undefined,
          level: "ERROR",
          stream: "stderr",
          line: `${t("runs.stepError.prefix")}${t("runs.stepError.prefixSep")}${summary}${detailPart}${codePart}`,
        }
      }
      return {
        ts: rec?.ts ? String(rec.ts) : undefined,
        level: rec?.level ? String(rec.level) : undefined,
        stream: rec?.stream ? String(rec.stream) : undefined,
        line: String(rec?.line ?? ""),
      }
    })
  }, [selectedLogs, t])
  const logFallbackLevel = React.useCallback(
    (line: { stream?: string }) => (line.stream === "stderr" ? "WARN" : "INFO"),
    [],
  )

  const firstErrorLogIndex = React.useMemo(() => {
    const idx = logViewerLines.findIndex((l) => String(l?.level ?? "").toUpperCase() === "ERROR")
    return idx >= 0 ? idx : 0
  }, [logViewerLines])

  const [logScrollRequest, setLogScrollRequest] = React.useState<{ version: number; index: number } | null>(null)
  const [logHighlightRequest, setLogHighlightRequest] = React.useState<{ version: number; index: number } | null>(null)
  // Important: only mark a request as "handled" after it actually applies. Otherwise, if the request
  // arrives while the user is on a different tab, it would be consumed and later navigation to Logs
  // would not trigger the highlight.
  const lastAppliedLogFocusVersionRef = React.useRef<number>(props.logFocusRequest?.version ?? 0)
  React.useEffect(() => {
    const req = props.logFocusRequest
    const v = req?.version ?? 0
    if (!v) return
    if (v === lastAppliedLogFocusVersionRef.current) return
    if (req?.mode !== "first_error") return
    if (!req?.stepKey) return
    // Only apply if we're viewing the same step and the logs tab is active.
    if (runTab !== "step") return
    if (stepTab !== "logs") return
    if (String(req.stepKey) !== String(props.selectedStepKey ?? "")) return
    lastAppliedLogFocusVersionRef.current = v
    setLogScrollRequest({ version: v, index: firstErrorLogIndex })
    setLogHighlightRequest({ version: v, index: firstErrorLogIndex })
  }, [firstErrorLogIndex, props.logFocusRequest, props.selectedStepKey, runTab, stepTab])

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", props.className)}>
      <SectionCard className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card text-card-foreground">
        <SectionCardBody className="overflow-hidden">
          {/* Mode 1: run-level tabs are primary; step-level tabs only live under the "Steps" view. */}
          <Tabs
            value={runTab}
            onValueChange={(v) => {
              if (v === "runInputs" || v === "artifacts" || v === "step" || v === "summary") setRunTab(v)
            }}
            className="flex h-full min-h-0 flex-col gap-0"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
              <div className="min-w-0 flex-1 overflow-x-auto">
                <TabsList className="w-max">
                  <TabsTrigger value="artifacts" className="flex-none sm:flex-1">
                    <span className="inline-flex items-center gap-1">
                      <Boxes className="size-3.5" aria-hidden="true" />
                      {t("runs.artifacts")}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="step" className="flex-none sm:flex-1">
                    <span className="inline-flex items-center gap-1">
                      <ListTree className="size-3.5" aria-hidden="true" />
                      {t("common.steps")}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="runInputs" className="flex-none sm:flex-1">
                    <span className="inline-flex items-center gap-1">
                      <Inbox className="size-3.5" aria-hidden="true" />
                      {t("runs.runInputs")}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="summary" className="flex-none sm:flex-1">
                    <span className="inline-flex items-center gap-1">
                      <BarChart3 className="size-3.5" aria-hidden="true" />
                      {t("runs.summaryTab")}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            <TabsContent value="artifacts" className="min-h-0">
              <div className="h-full min-h-0">
                {(() => {
                  if (artifactsLoading && !runOutputsLoaded && !artifactsLoaded)
                    return (
                      <TwoColumnSplitPanelSkeleton
                        left={{ content: "block" }}
                        right={{ content: "list", listRows: 3 }}
                      />
                    )
                  const outputsObj =
                    runOutputs?.outputs && typeof runOutputs.outputs === "object" ? runOutputs.outputs : null
                  const hasOutputs = outputsObj && Object.keys(outputsObj).length > 0
                  const hasArtifacts = artifactsLoaded && (deliverableArtifactViewerFiles?.length ?? 0) > 0

                  return (
                    <TwoColumnSplitPanel
                      isMobile={isMobile}
                      left={{
                        title: t("common.outputs"),
                        content: (
                          <JsonViewer
                            value={hasOutputs ? outputsObj : null}
                            empty={
                              runOutputsLoaded ? (
                                <div className="p-3 text-xs text-muted-foreground">
                                  {runOutputs?.error
                                    ? `${t("common.error")}: ${String(runOutputs.error)}`
                                    : t("runs.noOutputs")}
                                </div>
                              ) : null
                            }
                          />
                        ),
                      }}
                      right={{
                        title: t("runs.artifacts"),
                        content: (
                          <FileViewer
                            files={deliverableArtifactViewerFiles}
                            empty={
                              artifactsLoaded ? (
                                <div className="p-3 text-xs text-muted-foreground">{t("runs.noArtifacts")}</div>
                              ) : (
                                <div className="p-3 text-xs text-muted-foreground">{t("common.loading")}</div>
                              )
                            }
                          />
                        ),
                      }}
                    />
                  )
                })()}
              </div>
            </TabsContent>

            <TabsContent value="step" className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex min-w-0 items-center justify-start gap-2 px-3 pt-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-semibold">
                        {props.selectedStepName ?? props.selectedStepKey ?? "—"}
                      </div>
                      {props.selectedStepKey ? (
                        <Badge variant="secondary" className="h-5 px-2 font-mono text-[11px]">
                          {props.selectedStepKey}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {selectedStepStatus ? <StepOrAttemptStatusBadge status={selectedStepStatus} /> : null}
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                  <Tabs
                    value={stepTab}
                    onValueChange={(v) => {
                      if (
                        v === "logs" ||
                        v === "stepInput" ||
                        v === "stepOutput" ||
                        v === "stepDefinition" ||
                        v === "attempts"
                      )
                        setStepTab(v)
                    }}
                    className="flex h-full min-h-0 flex-col gap-0"
                  >
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                      <div className="min-w-0 flex-1 overflow-x-auto">
                        <TabsList className="w-max">
                          <TabsTrigger value="logs" className="flex-none sm:flex-1">
                            <span className="inline-flex items-center gap-1">
                              <ScrollText className="size-3.5" aria-hidden="true" />
                              {t("runs.logs")}
                            </span>
                          </TabsTrigger>
                          <TabsTrigger value="stepInput" className="flex-none sm:flex-1">
                            <span className="inline-flex items-center gap-1">
                              <Download className="size-3.5" aria-hidden="true" />
                              {t("runs.stepInput")}
                            </span>
                          </TabsTrigger>
                          <TabsTrigger value="stepOutput" className="flex-none sm:flex-1">
                            <span className="inline-flex items-center gap-1">
                              <Upload className="size-3.5" aria-hidden="true" />
                              {t("runs.stepOutput")}
                            </span>
                          </TabsTrigger>
                          <TabsTrigger value="stepDefinition" className="flex-none sm:flex-1">
                            <span className="inline-flex items-center gap-1">
                              <Braces className="size-3.5" aria-hidden="true" />
                              {t("runs.stepDefinition")}
                            </span>
                          </TabsTrigger>
                          <TabsTrigger value="attempts" className="flex-none sm:flex-1">
                            <span className="inline-flex items-center gap-1">
                              <History className="size-3.5" aria-hidden="true" />
                              {t("runs.runHistory")}
                            </span>
                          </TabsTrigger>
                        </TabsList>
                      </div>
                    </div>

                    <TabsContent value="logs" className="min-h-0">
                      <div className="h-full min-h-0">
                        {!props.selectedStepKey ? (
                          <StepLogsSkeleton />
                        ) : (
                          <LogViewer
                            lines={logViewerLines}
                            fallbackLevel={logFallbackLevel}
                            empty={<div className="text-muted-foreground">{t("errors.NO_LOGS")}</div>}
                            scrollRequest={
                              logScrollRequest
                                ? { version: logScrollRequest.version, index: logScrollRequest.index }
                                : undefined
                            }
                            highlightRequest={
                              logHighlightRequest
                                ? {
                                    version: logHighlightRequest.version,
                                    index: logHighlightRequest.index,
                                    ttlMs: 1600,
                                  }
                                : undefined
                            }
                          />
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="stepInput" className="min-h-0">
                      <TwoColumnSplitPanel
                        isMobile={isMobile}
                        loading={
                          (stepInputLoading && !inputJsonLoaded) || (stepArtifactsLoading && !stepArtifactsLoaded)
                        }
                        loadingNode={
                          <TwoColumnSplitPanelSkeleton
                            left={{ content: "block" }}
                            right={{ content: "list", listRows: 3 }}
                          />
                        }
                        left={{
                          title: (
                            <div className="flex items-center justify-between gap-2">
                              <span>{t("runs.parameters")}</span>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-4 px-0 text-xs"
                                onClick={() => setRunTab("runInputs")}
                              >
                                {t("runs.viewRunInputsAction")}
                              </Button>
                            </div>
                          ),
                          content: (
                            <JsonViewer
                              value={(() => {
                                if (!isRecord(inputJson)) return null
                                const upstream = inputJson.upstream
                                if (!isRecord(upstream)) return null
                                const entries = Object.entries(upstream)
                                if (entries.length === 0) return null
                                if (entries.length === 1) return entries[0]?.[1] ?? null
                                // Multi-upstream: show a compact array of { key, value } items.
                                return entries.map(([key, value]) => ({ key, value }))
                              })()}
                              empty={
                                inputJsonLoaded ? (
                                  inputJsonCode ? (
                                    <div className="p-3 text-xs text-muted-foreground">
                                      {errorTextFromCode(inputJsonCode) ?? t("common.error")}
                                    </div>
                                  ) : (
                                    <div className="p-3 text-xs text-muted-foreground">{t("runs.noParameters")}</div>
                                  )
                                ) : null
                              }
                            />
                          ),
                        }}
                        right={{
                          title: (
                            <div className="flex items-center justify-between gap-2">
                              <span>{t("runs.inputFiles")}</span>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-4 px-0 text-xs"
                                onClick={() => setRunTab("runInputs")}
                              >
                                {t("runs.viewRunInputsAction")}
                              </Button>
                            </div>
                          ),
                          content: (
                            <FileViewer
                              files={stepInputArtifactViewerFiles}
                              empty={
                                stepArtifactsLoaded ? (
                                  <div className="p-3 text-xs text-muted-foreground">{t("runs.noInputFiles")}</div>
                                ) : stepArtifactsLoading ? (
                                  <div className="p-3 text-xs text-muted-foreground">{t("common.loading")}</div>
                                ) : (
                                  <div className="p-3 text-xs text-muted-foreground">{t("common.loading")}</div>
                                )
                              }
                            />
                          ),
                        }}
                      />
                    </TabsContent>

                    <TabsContent value="stepOutput" className="min-h-0">
                      <div className="h-full min-h-0">
                        <TwoColumnSplitPanel
                          isMobile={isMobile}
                          loading={stepOutputLoading && !outputJsonLoaded && stepArtifactsLoading}
                          loadingNode={
                            <TwoColumnSplitPanelSkeleton
                              left={{ content: "block" }}
                              right={{ content: "list", listRows: 3 }}
                            />
                          }
                          left={{
                            title: t("runs.results"),
                            content: (
                              <JsonViewer
                                value={outputJson}
                                empty={
                                  outputJsonLoaded ? (
                                    <div className="p-3 text-xs text-muted-foreground">
                                      {errorTextFromCode(outputJsonCode ?? "NO_STEP_OUTPUT") ?? t("common.error")}
                                    </div>
                                  ) : null
                                }
                              />
                            ),
                          }}
                          right={{
                            title: t("runs.outputFiles"),
                            content: (
                              <FileViewer
                                files={stepOutputArtifactViewerFiles}
                                empty={
                                  stepArtifactsLoaded ? (
                                    <div className="p-3 text-xs text-muted-foreground">{t("runs.noArtifacts")}</div>
                                  ) : stepArtifactsLoading ? (
                                    <div className="p-3 text-xs text-muted-foreground">{t("common.loading")}</div>
                                  ) : (
                                    <div className="p-3 text-xs text-muted-foreground">{t("common.loading")}</div>
                                  )
                                }
                              />
                            ),
                          }}
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="stepDefinition" className="min-h-0">
                      {!props.selectedStepKey || (stepDefinitionLoading && !selectedStepDef) ? (
                        <StepDefinitionSkeleton />
                      ) : (
                        <div className="flex h-full min-h-0 flex-col">
                          {(() => {
                            const stepKey = props.selectedStepKey
                            if (!stepKey) return <div className="p-3 text-xs text-muted-foreground">—</div>
                            const payload = stepDefByStepKey[stepKey]
                            const inflight = stepDefLoadingByStepKey[stepKey] === true
                            if (!payload && inflight) return <StepDefinitionSkeleton />
                            if (!payload) return <div className="p-3 text-xs text-muted-foreground">—</div>
                            if (payload.available !== true) {
                              return (
                                <div className="p-3 text-xs text-muted-foreground">
                                  {errorTextFromCode(payload.code || "NO_STEP_DEFINITION") ?? t("common.error")}
                                </div>
                              )
                            }

                            const s = payload.step
                            const stepDepsCount = Array.isArray(s.deps) ? s.deps.length : 0
                            return (
                              <div className="flex h-full min-h-0 flex-col">
                                <div className="border-b px-3 py-2 text-xs">
                                  <InlineItemRow
                                    className="min-w-0"
                                    useBadge={true}
                                    wrap={true}
                                    iconSizeClassName="size-3.5"
                                    defaultVariant="secondary"
                                    items={[
                                      {
                                        key: "stepDepsCount",
                                        text: String(t("runs.stepDepsCount", { n: stepDepsCount })),
                                        Icon: ListTree,
                                        badgeClassName: "h-6 font-mono text-xs",
                                        textClassName: "text-xs",
                                      },
                                      {
                                        key: "timeout",
                                        text: `${t("runs.timeout")}:${formatDurationMs(s.timeoutMs)}`,
                                        Icon: Clock,
                                        badgeClassName: "h-6 font-mono text-xs",
                                        textClassName: "text-xs",
                                      },
                                    ]}
                                  />
                                </div>

                                <div className="min-h-0 flex-1 overflow-hidden">
                                  <CodeViewer code={s.scriptEsm || ""} language="javascript" className="h-full" />
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="attempts" className="min-h-0">
                      <ScrollArea className="h-full">
                        <div className="p-3">
                          {(() => {
                            if (!props.selectedStepKey) return <div className="text-muted-foreground">—</div>
                            const attempts = attemptsByStepKey[props.selectedStepKey]
                            if (!Array.isArray(attempts)) return <StepAttemptsSkeleton rows={3} />
                            if (attempts.length === 0)
                              return <div className="text-xs text-muted-foreground">{t("errors.NO_ATTEMPTS")}</div>
                            return (
                              <div className="space-y-4">
                                {attempts.map((a) => {
                                  const durMs = calcDurationMs(a.startedAt, a.finishedAt)
                                  const canonAttemptStatus = String(a.status || "").toUpperCase()
                                  const attemptUi = jobAttemptStatusUiSpec(canonAttemptStatus)
                                  const isFailed = canonAttemptStatus === "FAILED"

                                  const resolvedAttemptError = resolveAttemptDisplayError({
                                    errorCode: a.errorCode,
                                    errorMessage: a.errorMessage,
                                    errorMetaJson: a.errorMetaJson,
                                  })

                                  const hasErrorSummary =
                                    isFailed &&
                                    Boolean(
                                      resolvedAttemptError.displayCode ||
                                      a.errorCode ||
                                      a.errorMessage ||
                                      a.exitCode != null,
                                    )
                                  const displayCode = hasErrorSummary
                                    ? String(resolvedAttemptError.displayCode ?? a.errorCode ?? "UNKNOWN")
                                    : ""
                                  const wrapperCode = hasErrorSummary
                                    ? String(resolvedAttemptError.wrapperCode ?? a.errorCode ?? "UNKNOWN")
                                    : ""
                                  const wrapperMsg =
                                    hasErrorSummary && resolvedAttemptError.wrapperMessage
                                      ? String(resolvedAttemptError.wrapperMessage)
                                      : ""

                                  const Icon = attemptUi.Icon ?? Circle
                                  const leftIconNode = <Icon aria-hidden="true" />

                                  return (
                                    <StatusCollapsibleCard
                                      key={`${a.stepKey}:${a.attemptNo}`}
                                      icon={leftIconNode}
                                      leftIconClassName={cn(
                                        "h-4 w-4 shrink-0",
                                        attemptUi.iconClassName,
                                        attemptUi.varsClassName,
                                        attemptUi.textClassName,
                                      )}
                                      title={t("runs.attemptLine", { attemptNo: a.attemptNo })}
                                      summary={
                                        hasErrorSummary
                                          ? ({ open }) =>
                                              open ? (
                                                t("jobs.detail.attemptErrorDetailsHint")
                                              ) : (
                                                <span>{displayCode}</span>
                                              )
                                          : null
                                      }
                                      right={({ open }) => (
                                        <div className="flex items-center gap-3">
                                          {open ? null : (
                                            <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                                              <Clock3 className="h-4 w-4" aria-hidden="true" />
                                              <span>{durMs == null ? "—" : formatDurationMs(durMs)}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      defaultOpen={false}
                                      toggleAriaLabel={(open) =>
                                        open ? t("common.hideAction") : t("common.showAction")
                                      }
                                      bodyClassName="space-y-2"
                                    >
                                      <InlineItemRow
                                        useBadge
                                        wrap
                                        items={[
                                          {
                                            key: "startedAt",
                                            Icon: Clock3,
                                            text: `${t("jobs.detail.startedAt")}: ${formatRelativeTimeFromNow(
                                              a.startedAt,
                                              {
                                                locale,
                                              },
                                            )}`,
                                            title: formatAbsoluteTimeTitle(a.startedAt ?? null, {
                                              locale,
                                              timeZone: effectiveTimezone,
                                            }),
                                          },
                                          {
                                            key: "finishedAt",
                                            Icon: Clock3,
                                            text: `${t("jobs.detail.finishedAt")}: ${formatRelativeTimeFromNow(
                                              a.finishedAt,
                                              {
                                                locale,
                                              },
                                            )}`,
                                            title: formatAbsoluteTimeTitle(a.finishedAt ?? null, {
                                              locale,
                                              timeZone: effectiveTimezone,
                                            }),
                                          },
                                          {
                                            key: "duration",
                                            Icon: Clock3,
                                            text: `${t("common.duration")}: ${
                                              durMs == null ? "—" : formatDurationMs(durMs, { locale })
                                            }`,
                                          },
                                          ...(a.exitCode != null
                                            ? [
                                                {
                                                  key: "exitCode",
                                                  Icon: Hash,
                                                  text: t("runs.exit", { code: a.exitCode }),
                                                },
                                              ]
                                            : []),
                                        ]}
                                      />

                                      {hasErrorSummary ? (
                                        <KeyValueGrid>
                                          <KeyValueGrid.Row label="ERR_CODE" valueClassName="text-foreground">
                                            {displayCode}
                                          </KeyValueGrid.Row>

                                          {resolvedAttemptError.meta?.stepKey ? (
                                            <KeyValueGrid.Row label="STEP">
                                              {String(resolvedAttemptError.meta.stepKey)}
                                            </KeyValueGrid.Row>
                                          ) : (
                                            <KeyValueGrid.Row label="STEP">{String(a.stepKey)}</KeyValueGrid.Row>
                                          )}

                                          {wrapperCode || wrapperMsg ? (
                                            <KeyValueGrid.Row label="MESSAGE">
                                              {wrapperCode || "—"}
                                              {wrapperMsg ? `: ${wrapperMsg}` : ""}
                                            </KeyValueGrid.Row>
                                          ) : null}

                                          {resolvedAttemptError.meta?.timeoutMs != null ? (
                                            <KeyValueGrid.Row label="TIMEOUT">
                                              {formatDurationMs(resolvedAttemptError.meta.timeoutMs, { locale })}
                                            </KeyValueGrid.Row>
                                          ) : null}

                                          {resolvedAttemptError.meta?.exitCode != null || a.exitCode != null ? (
                                            <KeyValueGrid.Row label="EXIT_CODE">
                                              {String(resolvedAttemptError.meta?.exitCode ?? a.exitCode)}
                                            </KeyValueGrid.Row>
                                          ) : null}
                                        </KeyValueGrid>
                                      ) : null}
                                    </StatusCollapsibleCard>
                                  )
                                })}
                              </div>
                            )
                          })()}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="runInputs" className="min-h-0">
              {(() => {
                const maybeErrorMsg =
                  initialInputCode && initialInputCode !== "NO_RUN_INPUTS" ? (
                    <div className="p-3 text-xs text-muted-foreground">
                      {errorTextFromCode(initialInputCode) ?? t("common.error")}
                    </div>
                  ) : null

                const noParamsMsg = <div className="p-3 text-xs text-muted-foreground">{t("runs.noParameters")}</div>
                const noFilesMsg = <div className="p-3 text-xs text-muted-foreground">{t("runs.noInputFiles")}</div>

                const paramsEmpty = maybeErrorMsg ?? noParamsMsg
                const filesEmpty = maybeErrorMsg ?? noFilesMsg

                return (
                  <TwoColumnSplitPanel
                    isMobile={isMobile}
                    loading={runInputsLoading}
                    loadingNode={
                      <TwoColumnSplitPanelSkeleton
                        left={{ content: "block" }}
                        right={{ content: "list", listRows: 3 }}
                      />
                    }
                    left={{
                      title: t("runs.parameters"),
                      content: (
                        <JsonViewer
                          value={hasInitialParams ? initialInputParams : null}
                          empty={hasInitialParams ? null : paramsEmpty}
                        />
                      ),
                    }}
                    right={{
                      title: t("runs.inputFiles"),
                      content: (
                        <FileViewer files={fileViewerFiles} empty={fileViewerFiles.length > 0 ? null : filesEmpty} />
                      ),
                    }}
                  />
                )
              })()}
            </TabsContent>

            <TabsContent value="summary" className="min-h-0">
              <ScrollArea className="h-full">
                <div className="p-3">
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2">
                      <span className="text-muted-foreground">{t("common.statusValues.succeeded")}</span>
                      <span className="font-medium">{stepStats.SUCCEEDED ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2">
                      <span className="text-muted-foreground">{t("common.statusValues.failed")}</span>
                      <span className="font-medium">{stepStats.FAILED ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2">
                      <span className="text-muted-foreground">{t("common.statusValues.running")}</span>
                      <span className="font-medium">{stepStats.RUNNING ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2">
                      <span className="text-muted-foreground">{t("common.statusValues.queued")}</span>
                      <span className="font-medium">{stepStats.PENDING ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2">
                      <span className="text-muted-foreground">{t("runs.statusSkipped")}</span>
                      <span className="font-medium">{stepStats.SKIPPED ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2">
                      <span className="text-muted-foreground">{t("common.statusValues.canceled")}</span>
                      <span className="font-medium">{stepStats.CANCELED ?? 0}</span>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </SectionCardBody>

        {bottomTabHint ? (
          <SectionCardFooter>
            <div className="text-muted-foreground">{bottomTabHint}</div>
          </SectionCardFooter>
        ) : null}
      </SectionCard>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Braces, Info, Play, X } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageBlocker } from "@/components/ui/page-blocker"
import { WorkflowCombobox } from "@/components/common/workflow-combobox"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TextareaWithChrome } from "@/components/common/textarea-with-chrome"
import { useNewBatchForm } from "@/components/batches/hooks/use-new-batch-form"
import { FieldLabelWithHelp } from "@/components/common/field-label-with-help"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CollapsibleSectionCard } from "@/components/common/collapsible-section-card"
import { Badge } from "@/components/ui/badge"
import { SheetSkeleton } from "./new-batch-sheet-skeleton"
import { cn } from "@/lib/utils"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { batchJsonStatusUiSpec, type BatchJsonUiStatus } from "@/lib/shared/batch-status"
import { WorkflowVersionSelect } from "@/components/common/workflow-version-select"

export function NewBatchSheet(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const provMetaTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const provMetaFormatTimerRef = useRef<number | null>(null)
  const form = useNewBatchForm({ t })
  const [submitAction, setSubmitAction] = useState<"create" | null>(null)

  const {
    workflows,
    workflowId,
    setWorkflowId,
    workflowHasInputSpec,
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
    submitting,
    canSubmit,
  } = form
  const loading = form.loading
  const uiPending = submitting || submitAction !== null

  // Provenance (structured + free-form meta).
  // Single-user/local mode: owner is always "local" (no auth concept yet).
  const [provSource, setProvSource] = useState<"manual" | "import" | "backfill" | "api">("manual")
  const [provTicket, setProvTicket] = useState("")
  const [provDataset, setProvDataset] = useState("")
  const [provNote, setProvNote] = useState("")
  const [provMetaText, setProvMetaText] = useState("")

  useEffect(() => {
    if (!props.open) return
    setProvSource("manual")
    setProvTicket("")
    setProvDataset("")
    setProvNote("")
    setProvMetaText("")
  }, [props.open])

  const provMetaValue = useMemo(() => {
    const raw = String(provMetaText ?? "").trim()
    if (!raw) return undefined
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return raw
    }
  }, [provMetaText])

  const provMetaUi = useMemo(() => {
    const raw = String(provMetaText ?? "")
    const trimmed = raw.trim()
    if (!trimmed) return { kind: "EMPTY" as const }

    // Important UX rule:
    // - Only treat input as JSON when the user clearly intends JSON (starts with "{" or "[").
    // - Otherwise treat it as free-form text and don't show JSON state / auto-format.
    const jsonIntent = trimmed.startsWith("{") || trimmed.startsWith("[")
    if (!jsonIntent) return { kind: "TEXT" as const }

    try {
      const parsed = JSON.parse(trimmed)
      return { kind: "JSON_VALID" as const, formatted: JSON.stringify(parsed, null, 2) }
    } catch {
      return { kind: "JSON_INVALID" as const }
    }
  }, [provMetaText])

  const provMetaJsonStatus = useMemo((): BatchJsonUiStatus | null => {
    if (provMetaUi.kind === "EMPTY") return "NOT_CONFIGURED"
    if (provMetaUi.kind === "JSON_VALID") return "VALID"
    if (provMetaUi.kind === "JSON_INVALID") return "INVALID"
    return null // TEXT => don't show anything
  }, [provMetaUi.kind])

  const provMetaStatusUi = useMemo(() => {
    if (!provMetaJsonStatus) return null
    const ui = batchJsonStatusUiSpec(provMetaJsonStatus)
    const text =
      provMetaJsonStatus === "NOT_CONFIGURED"
        ? t("common.notConfigured")
        : provMetaJsonStatus === "VALID"
          ? t("workflows.inputSpec.validJson")
          : t("errors.INVALID_JSON")
    return { ...ui, text }
  }, [provMetaJsonStatus, t])

  // Auto-format provenance meta when it is valid JSON (but allow arbitrary text).
  useEffect(() => {
    const shouldFormat = provMetaUi.kind === "JSON_VALID"
    if (!shouldFormat) return
    const raw = String(provMetaText ?? "")
    const formatted = provMetaUi.formatted
    if (!formatted || formatted === raw.trim()) return

    if (provMetaFormatTimerRef.current != null) {
      window.clearTimeout(provMetaFormatTimerRef.current)
      provMetaFormatTimerRef.current = null
    }

    provMetaFormatTimerRef.current = window.setTimeout(() => {
      // Only format if textarea is focused (reduces surprising background edits).
      const el = provMetaTextareaRef.current
      const focused = !!el && document.activeElement === el
      if (!focused) return

      const selectionStart = el ? el.selectionStart : null
      const selectionEnd = el ? el.selectionEnd : null
      const scrollTop = el ? el.scrollTop : null

      setProvMetaText(formatted)

      requestAnimationFrame(() => {
        const el2 = provMetaTextareaRef.current
        if (!el2) return
        if (scrollTop != null) el2.scrollTop = scrollTop
        if (selectionStart != null && selectionEnd != null) {
          const max = formatted.length
          el2.setSelectionRange(Math.min(selectionStart, max), Math.min(selectionEnd, max))
        }
      })
    }, 450)

    return () => {
      if (provMetaFormatTimerRef.current != null) {
        window.clearTimeout(provMetaFormatTimerRef.current)
        provMetaFormatTimerRef.current = null
      }
    }
  }, [provMetaText, provMetaUi])

  const provenance = useMemo(() => {
    const ticket = provTicket.trim()
    const dataset = provDataset.trim()
    const note = provNote.trim()
    return {
      schemaVersion: 1,
      owner: "local",
      source: provSource,
      ...(ticket ? { ticket } : {}),
      ...(dataset ? { dataset } : {}),
      ...(note ? { note } : {}),
      ...(provMetaValue !== undefined ? { meta: provMetaValue } : {}),
    }
  }, [provDataset, provMetaValue, provNote, provSource, provTicket])

  const provenanceConfigured = useMemo(() => {
    if (provSource !== "manual") return true
    if (provTicket.trim()) return true
    if (provDataset.trim()) return true
    if (provNote.trim()) return true
    if (String(provMetaText ?? "").trim()) return true
    return false
  }, [provDataset, provMetaText, provNote, provSource, provTicket])

  function submit() {
    setSubmitAction("create")
    void form.createBatch({ sourceJson: provenance }).then((r) => {
      if (!r?.started) setSubmitAction(null)
    })
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (uiPending) return
        if (!open) setSubmitAction(null)
        props.onOpenChange(open)
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl flex flex-col"
        ref={contentRef}
        aria-busy={uiPending}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => {
            const root = contentRef.current
            if (!root) return
            const first =
              (root.querySelector(
                "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
              ) as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <PageBlocker active={uiPending} />

        <SheetHeader>
          <SheetTitle>{t("batches.newBatch")}</SheetTitle>
          <SheetDescription>{t("batches.newBatchDescription")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4 pt-0">
          {loading ? (
            <SheetSkeleton t={t} />
          ) : workflows.length === 0 ? (
            <Alert className="rounded-md">
              <Info aria-hidden="true" />
              <AlertTitle>{t("common.workflowRequiredTitle")}</AlertTitle>
              <AlertDescription>{t("common.workflowRequiredDescription")}</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-6">
              <div className="space-y-3">
                <CollapsibleSectionCard
                  title={t("batches.sections.basic")}
                  icon={<span className="text-muted-foreground">①</span>}
                  defaultOpen
                  bodyClassName="p-4"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <FieldGroup className="gap-4">
                    <Field className="gap-2">
                      <FieldLabel>{t("common.entities.workflow")}</FieldLabel>
                      <WorkflowCombobox
                        items={workflows.map((w) => ({ id: w.id, name: w.name }))}
                        value={workflowId}
                        onValueChange={setWorkflowId}
                        disabled={uiPending}
                        placeholder={t("jobs.selectWorkflow")}
                        searchPlaceholder={t("common.workflowCombobox.searchPlaceholder")}
                        emptyText={t("common.workflowCombobox.empty")}
                      />
                    </Field>

                    <Field className="gap-2">
                      <WorkflowVersionSelect
                        t={t}
                        workflowId={workflowId}
                        value={pinnedWorkflowVersionNumber}
                        onChange={setPinnedWorkflowVersionNumber}
                        disabled={uiPending}
                        allowDraft={true}
                      />
                    </Field>

                    <Field className="gap-2">
                      <FieldLabel htmlFor="batch-new-name">
                        {t("workflows.name")} <span className="font-normal">({t("common.optional")})</span>
                      </FieldLabel>
                      <Input
                        id="batch-new-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={uiPending}
                      />
                    </Field>
                  </FieldGroup>
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("common.executionPolicies")}
                  icon={<span className="text-muted-foreground">②</span>}
                  defaultOpen
                  bodyClassName="p-4"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <FieldLabelWithHelp
                        label={t("batches.concurrencyLimit")}
                        tooltip={t("batches.concurrencyLimitHint")}
                        htmlFor="batch-new-concurrency-limit"
                      />
                      <Input
                        id="batch-new-concurrency-limit"
                        type="number"
                        min={1}
                        max={10_000}
                        value={concurrencyLimit == null ? "" : String(concurrencyLimit)}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (!raw.trim()) {
                            setConcurrencyLimit(null)
                            return
                          }
                          const n = Number(raw)
                          setConcurrencyLimit(Number.isFinite(n) ? Math.max(1, Math.min(10_000, Math.floor(n))) : null)
                        }}
                        disabled={uiPending}
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <FieldLabelWithHelp
                          label={t("batches.rampUpSeconds")}
                          tooltip={t("batches.rampUpSecondsHint")}
                          htmlFor="batch-new-ramp-up-seconds"
                        />
                        <Input
                          id="batch-new-ramp-up-seconds"
                          type="number"
                          min={1}
                          max={86_400}
                          value={rampUpSeconds == null ? "" : String(rampUpSeconds)}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (!raw.trim()) {
                              setRampUpSeconds(null)
                              return
                            }
                            const n = Number(raw)
                            setRampUpSeconds(Number.isFinite(n) ? Math.max(1, Math.min(86_400, Math.floor(n))) : null)
                          }}
                          disabled={uiPending || concurrencyLimit != null}
                        />
                      </div>
                      <div className="grid gap-2">
                        <FieldLabelWithHelp
                          label={t("batches.autoMaxConcurrency")}
                          tooltip={t("batches.autoMaxConcurrencyHint")}
                          htmlFor="batch-new-auto-max-concurrency"
                        />
                        <Input
                          id="batch-new-auto-max-concurrency"
                          type="number"
                          min={1}
                          max={10_000}
                          value={autoMaxConcurrency == null ? "" : String(autoMaxConcurrency)}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (!raw.trim()) {
                              setAutoMaxConcurrency(null)
                              return
                            }
                            const n = Number(raw)
                            setAutoMaxConcurrency(
                              Number.isFinite(n) ? Math.max(1, Math.min(10_000, Math.floor(n))) : null,
                            )
                          }}
                          disabled={uiPending || concurrencyLimit != null}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <FieldLabelWithHelp
                          label={t("batches.failurePolicy")}
                          tooltip={t("batches.failurePolicyHint")}
                          htmlFor="batch-new-failure-policy"
                        />
                        <Select
                          value={failFast ? "FAIL_FAST" : maxFailures != null ? "MAX_FAILURES" : "NONE"}
                          onValueChange={(v) => {
                            if (v === "NONE") {
                              setFailFast(false)
                              setMaxFailures(null)
                              return
                            }
                            if (v === "FAIL_FAST") {
                              setFailFast(true)
                              setMaxFailures(null)
                              return
                            }
                            if (v === "MAX_FAILURES") {
                              setFailFast(false)
                              setMaxFailures((prev) => (prev == null ? 1 : prev))
                              return
                            }
                          }}
                          disabled={uiPending}
                        >
                          <SelectTrigger id="batch-new-failure-policy" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">{t("common.notConfigured")}</SelectItem>
                            <SelectItem value="FAIL_FAST">{t("batches.failurePolicyModeFailFast")}</SelectItem>
                            <SelectItem value="MAX_FAILURES">{t("batches.failurePolicyModeMaxFailures")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <FieldLabelWithHelp
                          label={t("batches.maxFailures")}
                          tooltip={t("batches.maxFailuresHint")}
                          htmlFor="batch-new-max-failures"
                        />
                        <Input
                          id="batch-new-max-failures"
                          type="number"
                          min={1}
                          max={10_000}
                          value={maxFailures == null ? "" : String(maxFailures)}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (!raw.trim()) {
                              setMaxFailures(null)
                              return
                            }
                            const n = Number(raw)
                            setMaxFailures(Number.isFinite(n) ? Math.max(1, Math.min(10_000, Math.floor(n))) : null)
                          }}
                          disabled={uiPending || maxFailures == null || failFast}
                          placeholder={maxFailures == null ? t("common.notConfigured") : undefined}
                        />
                      </div>
                    </div>
                  </div>
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("batches.sections.provenance")}
                  icon={<Braces className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                  right={
                    <Badge variant={provenanceConfigured ? "secondary" : "outline"} className="text-[10px]">
                      {provenanceConfigured ? t("common.configured") : t("common.optional")}
                    </Badge>
                  }
                  bodyClassName="p-4"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <FieldGroup className="gap-4">
                    <Field className="gap-2">
                      <FieldLabelWithHelp
                        label={t("batches.provenance.sourceLabel")}
                        tooltip={t("batches.provenance.sourceHelp")}
                        htmlFor="batch-new-prov-source"
                      />
                      <Select
                        value={provSource}
                        onValueChange={(v) =>
                          setProvSource(
                            v === "manual" || v === "import" || v === "backfill" || v === "api" ? v : "manual",
                          )
                        }
                        disabled={uiPending}
                      >
                        <SelectTrigger id="batch-new-prov-source" className="w-full">
                          <SelectValue placeholder={t("batches.provenance.sourcePlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">{t("common.source.manual")}</SelectItem>
                          <SelectItem value="import">{t("batches.provenance.sourceImport")}</SelectItem>
                          <SelectItem value="backfill">{t("batches.provenance.sourceBackfill")}</SelectItem>
                          <SelectItem value="api">{t("batches.provenance.sourceApi")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field className="gap-2">
                        <FieldLabel htmlFor="batch-new-prov-ticket">{t("batches.provenance.ticketLabel")}</FieldLabel>
                        <Input
                          id="batch-new-prov-ticket"
                          value={provTicket}
                          onChange={(e) => setProvTicket(e.target.value)}
                          placeholder={t("batches.provenance.ticketPlaceholder")}
                          disabled={uiPending}
                        />
                      </Field>
                      <Field className="gap-2">
                        <FieldLabel htmlFor="batch-new-prov-dataset">{t("batches.provenance.datasetLabel")}</FieldLabel>
                        <Input
                          id="batch-new-prov-dataset"
                          value={provDataset}
                          onChange={(e) => setProvDataset(e.target.value)}
                          placeholder={t("batches.provenance.datasetPlaceholder")}
                          disabled={uiPending}
                        />
                      </Field>
                    </div>

                    <Field className="gap-2">
                      <FieldLabel htmlFor="batch-new-prov-note">{t("common.note")}</FieldLabel>
                      <TextareaWithChrome
                        id="batch-new-prov-note"
                        value={provNote}
                        onChange={(e) => setProvNote(e.target.value)}
                        placeholder={t("batches.provenance.notePlaceholder")}
                        rows={3}
                        className="max-h-40"
                        disabled={uiPending}
                      />
                    </Field>

                    <Field className="gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <FieldLabelWithHelp
                          label={t("batches.provenance.metaLabel")}
                          tooltip={t("batches.provenance.metaHint")}
                          htmlFor="batch-new-prov-meta"
                        />
                        {provMetaStatusUi ? (
                          <InlineItemRow
                            className={cn(
                              "inline-flex text-xs",
                              provMetaStatusUi.varsClassName,
                              provMetaStatusUi.textClassName,
                            )}
                            iconSizeClassName="size-4"
                            wrap={false}
                            items={[
                              {
                                key: "provMetaStatus",
                                Icon: provMetaStatusUi.Icon,
                                iconOnly: false,
                                iconClassName: cn("shrink-0", provMetaStatusUi.textClassName),
                                text: provMetaStatusUi.text,
                              },
                            ]}
                          />
                        ) : null}
                      </div>

                      <TextareaWithChrome
                        id="batch-new-prov-meta"
                        ref={provMetaTextareaRef}
                        value={provMetaText}
                        onChange={(e) => setProvMetaText(e.target.value)}
                        placeholder={t("batches.provenance.metaPlaceholder")}
                        rows={6}
                        className="font-mono text-xs max-h-40"
                        disabled={uiPending}
                      />
                    </Field>
                  </FieldGroup>
                </CollapsibleSectionCard>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t p-4">
          <Button size="sm" className="w-full" onClick={submit} disabled={!canSubmit || uiPending}>
            {uiPending && submitAction === "create" ? <Spinner className="size-6" /> : <Play />}
            {t("common.createAction")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => props.onOpenChange(false)}
            disabled={uiPending}
          >
            <X />
            {t("common.cancelAction")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

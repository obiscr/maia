"use client"

import * as React from "react"
import { RotateCcw, Save } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Spinner } from "@/components/ui/spinner"
import { CollapsibleSectionCard } from "@/components/common/collapsible-section-card"
import { MaiaMonacoEditor } from "@/components/common/maia-monaco-editor"
import { SectionCard, SectionCardFooter, SectionCardHeader } from "@/components/common/section-card"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { setupMaiaMonaco, maiaMonacoOptions, MAIA_MONACO_THEME_DARK, MAIA_MONACO_THEME_LIGHT } from "@/lib/client/monaco"
import { FieldLabelWithHelp } from "@/components/common/field-label-with-help"
import {
  clearWorkflowCompletionContextForModelUri,
  registerMaiaWorkflowCompletions,
  setWorkflowCompletionMessages,
  setWorkflowCompletionContextForModelUri,
} from "@/lib/client/monaco-workflow-completions"
import { MAIA_JAVASCRIPT_LANGUAGE_ID } from "@/lib/client/monaco-maia-javascript"

export type WorkflowStepSheetStep = {
  stepKey: string
  name: string
  timeoutMs?: number
  scriptEsm: string
  deps?: string[]
}

export function WorkflowStepSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  emptyText: string

  step: WorkflowStepSheetStep | null
  workflowId: string
  workflowSteps?: Array<{ stepKey: string; name: string }>
  savePending?: boolean
  onSaveStep: (args: { originalStepKey: string; draft: WorkflowStepSheetStep }) => void | Promise<void>
}) {
  const { t, messages } = useI18n()
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  // Keep workflow editor completions localized with the active UI language.
  React.useEffect(() => {
    setWorkflowCompletionMessages(messages)
  }, [messages])

  const [draft, setDraft] = React.useState<WorkflowStepSheetStep | null>(null)
  const [originalStepKey, setOriginalStepKey] = React.useState<string | null>(null)

  const [isDarkTheme, setIsDarkTheme] = React.useState(false)
  React.useEffect(() => {
    const el = document.documentElement
    const update = () => setIsDarkTheme(el.classList.contains("dark"))
    update()
    const observer = new MutationObserver(() => update())
    observer.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  const monacoTheme = isDarkTheme ? MAIA_MONACO_THEME_DARK : MAIA_MONACO_THEME_LIGHT

  const step = props.step
  const modelUriRef = React.useRef<string | null>(null)

  const allStepKeys = React.useMemo(() => {
    return (props.workflowSteps ?? []).map((s) => String(s.stepKey)).filter(Boolean)
  }, [props.workflowSteps])

  const upstreamStepKeys = React.useMemo(() => {
    const deps = step?.deps ?? []
    return (deps ?? []).map(String).filter(Boolean)
  }, [step?.deps])

  const stepNameByKey = React.useMemo(() => {
    const out: Record<string, string | undefined> = {}
    for (const s of props.workflowSteps ?? []) out[String(s.stepKey)] = String(s.name ?? "")
    return out
  }, [props.workflowSteps])

  // Keep completion context synced to this editor instance (no script mutation).
  React.useEffect(() => {
    const modelUri = modelUriRef.current
    if (!modelUri) return
    if (!props.open) return
    setWorkflowCompletionContextForModelUri(modelUri, {
      workflowId: props.workflowId,
      allStepKeys,
      upstreamStepKeys,
      stepNameByKey,
    })
  }, [allStepKeys, props.open, props.workflowId, stepNameByKey, upstreamStepKeys])

  React.useEffect(() => {
    return () => {
      const modelUri = modelUriRef.current
      if (modelUri) clearWorkflowCompletionContextForModelUri(modelUri)
      modelUriRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (!props.open) return
    if (!step) {
      setDraft(null)
      setOriginalStepKey(null)
      return
    }
    setDraft({
      stepKey: step.stepKey,
      name: step.name,
      timeoutMs: step.timeoutMs,
      scriptEsm: step.scriptEsm,
    })
    setOriginalStepKey(step.stepKey)
  }, [props.open, step?.stepKey])

  const dirty = React.useMemo(() => {
    if (!draft || !step) return false
    return (
      draft.stepKey !== step.stepKey ||
      draft.name !== step.name ||
      (draft.timeoutMs ?? undefined) !== (step.timeoutMs ?? undefined) ||
      draft.scriptEsm !== step.scriptEsm
    )
  }, [draft, step])

  const canSave = React.useMemo(() => {
    if (!draft || !dirty) return false
    if (!draft.stepKey.trim().length) return false
    if (!draft.name.trim().length) return false
    return true
  }, [draft, dirty])

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col"
        ref={contentRef}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => {
            const root = contentRef.current
            if (!root) return
            const first =
              (root.querySelector(
                "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
              ) as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription className="sr-only">{props.emptyText}</SheetDescription>
        </SheetHeader>

        {!draft ? (
          <div className="text-sm text-muted-foreground">{props.emptyText}</div>
        ) : (
          <div className="min-h-0 flex flex-1 flex-col gap-4 px-4 pb-4">
            <CollapsibleSectionCard
              title={t("workflows.stepBasics")}
              defaultOpen
              bodyClassName="p-4"
              toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="wf-step-stepKey">{t("workflows.stepKey")}</FieldLabel>
                  <Input
                    id="wf-step-stepKey"
                    value={draft.stepKey}
                    onChange={(e) => setDraft((p) => (p ? { ...p, stepKey: e.target.value } : p))}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="wf-step-name">{t("workflows.name")}</FieldLabel>
                  <Input
                    id="wf-step-name"
                    value={draft.name}
                    onChange={(e) => setDraft((p) => (p ? { ...p, name: e.target.value } : p))}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="wf-step-timeoutMs">{t("workflows.timeoutMs")}</FieldLabel>
                  <Input
                    id="wf-step-timeoutMs"
                    type="number"
                    value={draft.timeoutMs == null ? "" : String(draft.timeoutMs)}
                    onChange={(e) => {
                      const raw = e.target.value
                      const next = raw === "" ? undefined : Number(raw)
                      setDraft((p) => {
                        if (!p) return p
                        return { ...p, timeoutMs: Number.isFinite(next as number) ? (next as number) : p.timeoutMs }
                      })
                    }}
                  />
                </Field>
              </FieldGroup>
            </CollapsibleSectionCard>

            {/* Script editor (fills remaining space) */}
            <div className="min-h-0 flex flex-1 flex-col">
              <SectionCard className="flex flex-col">
                <SectionCardHeader>
                  <FieldLabelWithHelp label={t("workflows.scriptEsm")} tooltip={t("workflows.scriptEsmTooltip")} />
                </SectionCardHeader>

                <div className="min-h-0 flex-1">
                  <MaiaMonacoEditor
                    height="100%"
                    defaultLanguage={MAIA_JAVASCRIPT_LANGUAGE_ID}
                    theme={monacoTheme}
                    value={draft.scriptEsm}
                    onChange={(v) => setDraft((p) => (p ? { ...p, scriptEsm: v ?? "" } : p))}
                    beforeMount={(monaco) => {
                      setupMaiaMonaco(monaco)
                      setWorkflowCompletionMessages(messages)
                      registerMaiaWorkflowCompletions(monaco)
                    }}
                    options={maiaMonacoOptions}
                    onMount={(editor) => {
                      const modelUri = editor.getModel()?.uri.toString() ?? null
                      modelUriRef.current = modelUri
                      if (!modelUri) return
                      setWorkflowCompletionContextForModelUri(modelUri, {
                        workflowId: props.workflowId,
                        allStepKeys,
                        upstreamStepKeys,
                        stepNameByKey,
                      })
                    }}
                  />
                </div>
                <SectionCardFooter>
                  <div className="text-xs text-muted-foreground">{t("workflows.engineRunsTip")}</div>
                </SectionCardFooter>
              </SectionCard>
            </div>
          </div>
        )}

        <SheetFooter className="border-t bg-background">
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!draft || !originalStepKey || !canSave || !!props.savePending}
              onClick={() => {
                if (!draft || !originalStepKey) return
                void props.onSaveStep({ originalStepKey, draft })
              }}
            >
              {props.savePending ? <Spinner className="h-4 w-4" /> : <Save />}
              {props.savePending ? t("common.saving") : t("common.saveAction")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!draft || !step || !dirty || !!props.savePending}
              onClick={() => {
                if (!step) return
                setDraft({
                  stepKey: step.stepKey,
                  name: step.name,
                  timeoutMs: step.timeoutMs,
                  scriptEsm: step.scriptEsm,
                })
                setOriginalStepKey(step.stepKey)
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {t("common.resetAction")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

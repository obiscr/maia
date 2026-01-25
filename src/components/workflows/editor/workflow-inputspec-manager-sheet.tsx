"use client"

import * as React from "react"
import { Bot, Braces, Pencil, Plus, RotateCcw, Save } from "lucide-react"

import { AgentButton } from "@/components/ui/agent-button"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useI18n } from "@/components/i18n-provider"
import { ErrorAlert } from "@/components/common/error-alert"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { SectionCard, SectionCardBody, SectionCardFooter, SectionCardHeader } from "@/components/common/section-card"
import { MaiaMonacoEditor } from "@/components/common/maia-monaco-editor"
import {
  setupMaiaMonaco,
  maiaMonacoOptions,
  MAIA_MONACO_THEME_DARK,
  MAIA_MONACO_THEME_LIGHT,
} from "@/lib/client/monaco"
import { toUiWorkflowInputSpecStatus, workflowInputSpecStatusUiSpec } from "@/lib/shared/workflow-inputspec-status"
import { cn } from "@/lib/utils"

export function WorkflowInputSpecManagerSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contentRef: React.RefObject<HTMLDivElement | null>
  trigger?: React.ReactElement

  inputSpecDraftJson: string
  onInputSpecDraftJsonChange: (v: string) => void
  inputSpecJson: string

  inputSpecDirty: boolean
  inputSpecJsonOk: boolean
  inputSpecErr: string | null
  inputSpecAiErr: string | null
  inputSpecAiPending: boolean
  inputSpecServerErr: unknown

  onGenerateWithAi: () => void | Promise<void>
  onInsertDefault: () => void
  onResetDraft: () => void
  onSaveAndClose: () => void | Promise<void>

  saving: boolean
}) {
  const { t } = useI18n()

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

  const configured = !!props.inputSpecJson.trim().length
  const invalid = !props.inputSpecJsonOk || !!props.inputSpecErr
  const inputSpecUiStatus = toUiWorkflowInputSpecStatus({
    configured,
    dirty: props.inputSpecDirty,
    invalid,
  })
  const inputSpecUi = workflowInputSpecStatusUiSpec(inputSpecUiStatus)

  let inputSpecStatusLabel: string
  switch (inputSpecUi.status) {
    case "DIRTY":
      inputSpecStatusLabel = t("common.unsavedChanges")
      break
    case "NOT_CONFIGURED":
      inputSpecStatusLabel = t("common.notConfigured")
      break
    case "VALID":
      inputSpecStatusLabel = t("workflows.inputSpec.validJson")
      break
    case "INVALID":
      inputSpecStatusLabel = t("errors.INVALID_JSON")
      break
    default:
      inputSpecStatusLabel = inputSpecUi.status
      break
  }

  const canFormat = props.inputSpecJsonOk && !!props.inputSpecDraftJson.trim().length
  function formatJson() {
    const trimmed = props.inputSpecDraftJson.trim()
    if (!trimmed.length) return
    try {
      const obj = JSON.parse(trimmed) as unknown
      props.onInputSpecDraftJsonChange(JSON.stringify(obj, null, 2))
    } catch {
      // If JSON is invalid, keep current content unchanged.
    }
  }

  // Default: auto-format JSON once when the sheet is opened (no extra button/state).
  const prevOpenRef = React.useRef<boolean>(props.open)
  React.useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = props.open
    if (wasOpen || !props.open) return

    const trimmed = props.inputSpecDraftJson.trim()
    if (!trimmed.length) return
    try {
      const obj = JSON.parse(trimmed) as unknown
      const formatted = JSON.stringify(obj, null, 2)
      if (formatted !== trimmed) props.onInputSpecDraftJsonChange(formatted)
    } catch {
      // Ignore invalid JSON.
    }
  }, [props.open, props.inputSpecDraftJson, props.onInputSpecDraftJsonChange])

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetTrigger asChild>
        {props.trigger ?? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Pencil className="size-3.5" aria-hidden="true" />
            {t("common.editAction")}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl flex flex-col"
        ref={props.contentRef}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => {
            const root = props.contentRef.current
            if (!root) return
            const first =
              (root.querySelector(
                "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
              ) as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <SheetHeader>
          <SheetTitle>{t("workflows.inputSpec.title")}</SheetTitle>
          <SheetDescription>{t("workflows.inputSpec.description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 p-4 pt-0 space-y-3">
          {props.inputSpecServerErr ? (
            <ErrorAlert
              error={props.inputSpecServerErr}
              titleKey="errors.SAVE_FAILED"
              actions={[{ key: "retry", label: t("common.retryAction"), onClick: () => void props.onSaveAndClose() }]}
              variant="default"
            />
          ) : null}

          <SectionCard>
            <SectionCardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <AgentButton
                  type="button"
                  size="sm"
                  onClick={() => void props.onGenerateWithAi()}
                  loading={props.inputSpecAiPending}
                  icon={<Bot className="h-4 w-4" />}
                >
                  {props.inputSpecAiPending
                    ? t("workflows.inputSpec.generatingWithAi")
                    : t("workflows.inputSpec.generateWithAi")}
                </AgentButton>
                <Button type="button" variant="outline" size="sm" onClick={props.onInsertDefault}>
                  <Plus className="h-4 w-4" />
                  {t("workflows.inputSpec.insertDefaultAction")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={formatJson} disabled={!canFormat}>
                  <Braces className="h-4 w-4" />
                  {t("workflows.inputSpec.formatAction")}
                </Button>
              </div>
            </SectionCardHeader>

            <SectionCardBody>
              <MaiaMonacoEditor
                height="60vh"
                defaultLanguage="json"
                theme={monacoTheme}
                value={props.inputSpecDraftJson}
                onChange={(v) => props.onInputSpecDraftJsonChange(v ?? "")}
                beforeMount={setupMaiaMonaco}
                options={maiaMonacoOptions}
              />
            </SectionCardBody>

            <SectionCardFooter>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={cn("flex min-w-0 flex-1 items-center gap-2 overflow-hidden", inputSpecUi.varsClassName)}
                  >
                    <InlineItemRow
                      className={cn(
                        "inline-flex text-sm min-w-0",
                        inputSpecUi.varsClassName,
                        inputSpecUi.textClassName,
                      )}
                      iconSizeClassName="size-4"
                      wrap={false}
                      items={[
                        {
                          key: "inputSpecStatus",
                          Icon: inputSpecUi.Icon ?? null,
                          iconClassName: cn("shrink-0", inputSpecUi.iconClassName),
                          text: inputSpecStatusLabel,
                        },
                      ]}
                    />
                    {inputSpecUi.status === "INVALID" && props.inputSpecErr ? (
                      <div
                        className={cn("min-w-0 flex-1 text-sm truncate", inputSpecUi.textClassName)}
                        title={String(props.inputSpecErr)}
                      >
                        {String(props.inputSpecErr)}
                      </div>
                    ) : null}
                  </div>
                  {props.inputSpecAiErr ? (
                    <div
                      className={cn(
                        "min-w-0 flex-1 text-sm truncate",
                        "maia-status-badge--failed",
                        "text-[color:var(--maia-status-text)]",
                      )}
                      title={String(props.inputSpecAiErr)}
                    >
                      {String(props.inputSpecAiErr)}
                    </div>
                  ) : null}
                </div>
              </div>
            </SectionCardFooter>
          </SectionCard>
        </div>

        <SheetFooter className="border-t bg-background">
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void props.onSaveAndClose()}
              disabled={props.saving || !props.inputSpecJsonOk || !props.inputSpecDirty}
            >
              {props.saving ? <Spinner className="h-4 w-4" /> : <Save />}
              {props.saving ? t("common.saving") : t("common.saveAction")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={props.onResetDraft}
              disabled={props.saving || !props.inputSpecDirty}
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

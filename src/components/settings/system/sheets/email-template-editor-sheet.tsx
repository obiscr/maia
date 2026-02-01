"use client"

import * as React from "react"
import { RotateCcw, Save } from "lucide-react"
import type { editor as MonacoEditor } from "monaco-editor"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MaiaMonacoEditor } from "@/components/common/maia-monaco-editor"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  maiaMonacoOptions,
  MAIA_MONACO_THEME_DARK,
  MAIA_MONACO_THEME_LIGHT,
  setupMaiaMonaco,
} from "@/lib/client/monaco"
import { SectionCard, SectionCardBody, SectionCardFooter, SectionCardHeader } from "@/components/common/section-card"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { renderTemplateString } from "@/lib/shared/email/template-string"
import { formatHtmlTemplate } from "@/lib/shared/email/html-format"

export type EmailTemplateEditorModel = {
  key: string
  locale: string
  subjectTemplate: string
  htmlTemplate: string
  textTemplate: string | null
  schemaJson: string
}

type EmailTemplateSchema = {
  vars?: string[]
  example?: Record<string, unknown>
}

function parseSchemaVars(schemaJson: string): string[] {
  const raw = String(schemaJson ?? "").trim()
  if (!raw) return []
  try {
    const obj = JSON.parse(raw) as EmailTemplateSchema
    const vars = Array.isArray(obj?.vars) ? obj.vars : []
    return vars.map((v) => String(v)).filter((v) => !!v.trim())
  } catch {
    return []
  }
}

function parseSchemaExample(schemaJson: string): Record<string, unknown> {
  const raw = String(schemaJson ?? "").trim()
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw) as EmailTemplateSchema
    const ex = obj?.example
    if (!ex || typeof ex !== "object" || Array.isArray(ex)) return {}
    return ex as Record<string, unknown>
  } catch {
    return {}
  }
}

export function EmailTemplateEditorSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void

  template: EmailTemplateEditorModel | null
  locales: string[]
  onChangeLocale: (nextLocale: string) => void

  saving?: boolean
  onSave: (draft: EmailTemplateEditorModel) => void | Promise<void>
}) {
  const { t } = useI18n()
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const htmlEditorRef = React.useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [htmlTab, setHtmlTab] = React.useState<"source" | "preview">("source")

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

  const [draft, setDraft] = React.useState<EmailTemplateEditorModel | null>(null)
  const [initial, setInitial] = React.useState<EmailTemplateEditorModel | null>(null)

  const normalizeTemplate = React.useCallback((tpl: EmailTemplateEditorModel): EmailTemplateEditorModel => {
    return { ...tpl, htmlTemplate: formatHtmlTemplate(tpl.htmlTemplate) }
  }, [])

  React.useEffect(() => {
    if (!props.open) return
    const tpl = props.template ? normalizeTemplate(props.template) : null
    setDraft(tpl)
    setInitial(tpl)
    setHtmlTab("source")
  }, [normalizeTemplate, props.open, props.template?.key, props.template?.locale])

  // After a successful save, sync the editor with the (potentially formatted) persisted version.
  const prevSavingRef = React.useRef<boolean>(Boolean(props.saving))
  React.useEffect(() => {
    const prev = prevSavingRef.current
    const cur = Boolean(props.saving)
    prevSavingRef.current = cur
    if (!props.open) return
    if (!prev || cur) return
    if (!props.template) return
    const tpl = normalizeTemplate(props.template)
    setDraft(tpl)
    setInitial(tpl)
  }, [normalizeTemplate, props.open, props.saving, props.template])

  const dirty = React.useMemo(() => {
    if (!draft || !initial) return false
    return (
      draft.subjectTemplate !== initial.subjectTemplate ||
      draft.htmlTemplate !== initial.htmlTemplate ||
      (draft.textTemplate ?? null) !== (initial.textTemplate ?? null) ||
      draft.schemaJson !== initial.schemaJson
    )
  }, [draft, initial])

  const canSave = React.useMemo(() => {
    if (!draft || !dirty) return false
    if (!draft.subjectTemplate.trim().length) return false
    if (!draft.htmlTemplate.trim().length) return false
    return true
  }, [dirty, draft])

  const templateTitle = React.useMemo(() => {
    if (!draft?.key) return ""
    const titleKey = `settings.system.emailTemplates.items.${draft.key}.title`
    const v = t(titleKey)
    return v === titleKey ? draft.key : v
  }, [draft?.key, t])

  const templateDescription = React.useMemo(() => {
    if (!draft?.key) return ""
    const descriptionKey = `settings.system.emailTemplates.items.${draft.key}.description`
    const v = t(descriptionKey)
    return v === descriptionKey ? "" : v
  }, [draft?.key, t])

  const htmlOptions = React.useMemo(() => {
    return { ...maiaMonacoOptions, wordWrap: "on" as const }
  }, [])

  const schemaVars = React.useMemo(() => (draft ? parseSchemaVars(draft.schemaJson) : []), [draft?.schemaJson])
  const schemaExample = React.useMemo(() => (draft ? parseSchemaExample(draft.schemaJson) : {}), [draft?.schemaJson])

  const renderedSubject = React.useMemo(() => {
    if (!draft) return ""
    return renderTemplateString(draft.subjectTemplate, schemaExample)
  }, [draft?.subjectTemplate, schemaExample])

  const renderedHtml = React.useMemo(() => {
    if (!draft) return ""
    return renderTemplateString(draft.htmlTemplate, schemaExample)
  }, [draft?.htmlTemplate, schemaExample])

  function localeLabel(localeCode: string) {
    const l = String(localeCode ?? "")
      .trim()
      .toLowerCase()
    if (l === "en") return t("language.english")
    if (l === "zh-cn" || l.startsWith("zh")) return t("language.chinese")
    return localeCode
  }

  function insertAtCursor(snippet: string) {
    const editor = htmlEditorRef.current
    if (!editor) return
    const model = editor.getModel()
    const sel = editor.getSelection()
    if (!model || !sel) return
    editor.pushUndoStop()
    editor.executeEdits("insert-email-var", [
      {
        range: sel,
        text: snippet,
        forceMoveMarkers: true,
      },
    ])
    editor.pushUndoStop()
    editor.focus()
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl flex flex-col"
        ref={contentRef}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => {
            const root = contentRef.current
            if (!root) return
            const first = (root.querySelector("input:not([disabled])") as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <SheetHeader>
          <SheetTitle>{templateTitle || t("settings.system.emailTemplates.editorSheetTitle")}</SheetTitle>
          {templateDescription ? <SheetDescription>{templateDescription}</SheetDescription> : null}
        </SheetHeader>

        {!draft ? (
          <div className="text-sm text-muted-foreground">{t("settings.system.emailTemplates.editorEmptyHint")}</div>
        ) : (
          <div className="min-h-0 flex flex-1 flex-col gap-4 px-4 pb-4">
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="email-template-locale">{t("settings.system.emailTemplates.locale")}</FieldLabel>
                <Select value={draft.locale} onValueChange={(v) => props.onChangeLocale(v)}>
                  <SelectTrigger id="email-template-locale">
                    <SelectValue placeholder={t("settings.system.emailTemplates.locale")} />
                  </SelectTrigger>
                  <SelectContent>
                    {props.locales.map((l) => (
                      <SelectItem key={l} value={l}>
                        {localeLabel(l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="email-template-subject">
                  {t("settings.system.emailTemplates.subjectTemplate")}
                </FieldLabel>
                <Input
                  id="email-template-subject"
                  value={draft.subjectTemplate}
                  onChange={(e) => setDraft((p) => (p ? { ...p, subjectTemplate: e.target.value } : p))}
                />
              </Field>
            </FieldGroup>

            <div className="min-h-0 flex flex-1 flex-col">
              <SectionCard className="flex flex-col">
                <SectionCardHeader className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{t("settings.system.emailTemplates.body")}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      disabled={!draft.htmlTemplate.trim().length}
                      onClick={() => {
                        setDraft((p) => (p ? { ...p, htmlTemplate: formatHtmlTemplate(p.htmlTemplate) } : p))
                      }}
                    >
                      {t("settings.system.emailTemplates.formatAction")}
                    </Button>
                    <Tabs value={htmlTab} onValueChange={(v) => setHtmlTab(v === "preview" ? "preview" : "source")}>
                      <TabsList className="h-7 rounded-md border p-0.5">
                        <TabsTrigger
                          value="source"
                          className="h-5.5 px-2 text-xs font-medium rounded-[6px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
                        >
                          {t("settings.system.emailTemplates.source")}
                        </TabsTrigger>
                        <TabsTrigger
                          value="preview"
                          className="h-5.5 px-2 text-xs font-medium rounded-[6px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
                        >
                          {t("settings.system.emailTemplates.preview")}
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </SectionCardHeader>

                <SectionCardBody className="min-h-0 flex flex-1 flex-col gap-3">
                  <div className="min-h-0 flex-1">
                    <Tabs value={htmlTab} className="min-h-0 h-full flex flex-col gap-0">
                      <TabsContent value="source" className="min-h-0 flex-1 mt-0">
                        <MaiaMonacoEditor
                          height="100%"
                          defaultLanguage="html"
                          theme={monacoTheme}
                          value={draft.htmlTemplate}
                          onChange={(v) => setDraft((p) => (p ? { ...p, htmlTemplate: v ?? "" } : p))}
                          beforeMount={(monaco) => setupMaiaMonaco(monaco)}
                          onMount={(editor) => {
                            htmlEditorRef.current = editor
                          }}
                          options={htmlOptions}
                        />
                      </TabsContent>
                      <TabsContent value="preview" className="min-h-0 flex-1 mt-0">
                        <div className="h-full w-full overflow-hidden bg-background">
                          <iframe
                            title={t("settings.system.emailTemplates.preview")}
                            className="h-full w-full"
                            // Prevent scripts/navigation while still rendering HTML/CSS.
                            sandbox=""
                            srcDoc={draft.htmlTemplate}
                          />
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                </SectionCardBody>
                <SectionCardFooter>
                  {schemaVars.length ? (
                    <InlineItemRow
                      items={schemaVars.map((v) => ({
                        key: v,
                        text: `{{${v}}}`,
                        onClick: () => insertAtCursor(`{{${v}}}`),
                      }))}
                      useBadge
                      wrap
                    />
                  ) : null}
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
              disabled={!draft || !canSave || !!props.saving}
              onClick={() => {
                if (!draft) return
                void props.onSave(draft)
              }}
            >
              {props.saving ? <Spinner className="h-4 w-4" /> : <Save />}
              {props.saving ? t("common.saving") : t("common.saveAction")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!draft || !initial || !dirty || !!props.saving}
              onClick={() => {
                if (!initial) return
                setDraft({ ...initial })
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("common.resetAction")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

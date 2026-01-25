"use client"

import * as React from "react"
import { Check, Copy, Pencil, RotateCcw, Save } from "lucide-react"

import { ErrorAlert } from "@/components/common/error-alert"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { TextareaWithChrome } from "@/components/common/textarea-with-chrome"
import { useI18n } from "@/components/i18n-provider"
import { useCopyButton } from "@/hooks/use-copy-button"

export function WorkflowMetaManagerSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger?: React.ReactElement
  contentRef: React.RefObject<HTMLDivElement | null>

  workflowId: string

  nameDraft: string
  onNameDraftChange: (name: string) => void
  descriptionDraft: string
  onDescriptionDraftChange: (description: string) => void

  savedName: string
  savedDescription: string

  savePending: boolean
  serverErr: unknown
  onSave: () => void | Promise<void>
  onResetDraft: () => void
}) {
  const { t } = useI18n()
  const { copied, handleCopy } = useCopyButton()
  const workflowIdInputId = React.useId()

  const nameTrimmed = (props.nameDraft ?? "").trim()
  const descTrimmed = (props.descriptionDraft ?? "").trim()

  const dirty = nameTrimmed !== (props.savedName ?? "").trim() || descTrimmed !== (props.savedDescription ?? "").trim()

  const nameOk = nameTrimmed.length > 0
  const saveDisabled = props.savePending || !dirty || !nameOk
  const resetDisabled = props.savePending || !dirty

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
              (root.querySelector("input:not([disabled]), textarea:not([disabled])") as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <SheetHeader>
          <SheetTitle>{t("workflows.meta.title")}</SheetTitle>
          <SheetDescription>{t("workflows.meta.description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 p-4 pt-0 space-y-3">
          {props.serverErr ? (
            <ErrorAlert
              error={props.serverErr}
              titleKey="errors.SAVE_FAILED"
              actions={[{ key: "retry", label: t("common.retryAction"), onClick: () => void props.onSave() }]}
              variant="default"
            />
          ) : null}

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={workflowIdInputId}>{t("workflows.importExport.labels.workflowId")}</FieldLabel>
              <div className="relative">
                <Input id={workflowIdInputId} value={props.workflowId} readOnly className="pr-10 font-mono text-sm" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0 focus-visible:border-transparent"
                  aria-label={t("common.copyAction")}
                  onClick={() => handleCopy(props.workflowId)}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="wf-meta-name">{t("workflows.name")}</FieldLabel>
              <Input
                id="wf-meta-name"
                value={props.nameDraft}
                onChange={(e) => props.onNameDraftChange(e.target.value)}
              />
              {!nameOk ? <FieldError>{t("workflows.meta.errors.nameRequired")}</FieldError> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="wf-meta-description">
                {t("workflows.description")} <span className="font-normal">({t("common.optional")})</span>
              </FieldLabel>
              <TextareaWithChrome
                id="wf-meta-description"
                value={props.descriptionDraft}
                onChange={(e) => props.onDescriptionDraftChange(e.target.value)}
                rows={6}
                className="max-h-48"
                placeholder={t("workflows.description")}
              />
            </Field>
          </FieldGroup>
        </div>

        <SheetFooter className="border-t bg-background">
          <div className="flex flex-col gap-2">
            <Button type="button" size="sm" onClick={() => void props.onSave()} disabled={saveDisabled}>
              {props.savePending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {props.savePending ? t("common.saving") : t("common.saveAction")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={props.onResetDraft} disabled={resetDisabled}>
              <RotateCcw className="h-4 w-4" />
              {t("common.resetAction")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

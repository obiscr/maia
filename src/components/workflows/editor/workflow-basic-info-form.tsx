"use client"

import { useId } from "react"

import { TextareaWithChrome } from "@/components/common/textarea-with-chrome"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/components/i18n-provider"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"

export function WorkflowBasicInfoForm(props: {
  name: string
  description: string
  onNameChange: (name: string) => void
  onDescriptionChange: (description: string) => void
}) {
  const { t } = useI18n()
  const nameId = useId()
  const descriptionId = useId()

  return (
    <FieldGroup className="gap-3">
      <Field className="gap-2">
        <FieldLabel htmlFor={nameId}>{t("workflows.name")}</FieldLabel>
        <Input id={nameId} value={props.name} onChange={(e) => props.onNameChange(e.target.value)} />
      </Field>

      <Field className="gap-2">
        <FieldLabel htmlFor={descriptionId}>{t("workflows.description")}</FieldLabel>
        <TextareaWithChrome
          id={descriptionId}
          value={props.description}
          onChange={(e) => props.onDescriptionChange(e.target.value)}
          rows={6}
          className="max-h-40"
        />
      </Field>
    </FieldGroup>
  )
}

"use client"

import { useId } from "react"
import type * as React from "react"

import { FieldHeader } from "@/components/common/field-header"
import { TextareaWithChrome } from "@/components/common/textarea-with-chrome"
import { cn } from "@/lib/utils"

export function UrlFilesEditor(props: {
  title: string
  required?: boolean
  codeLabel?: string | null
  hintText?: string | null
  icon?: React.ReactNode
  rightSlot?: React.ReactNode

  value: string
  onChange: (next: string) => void
  disabled?: boolean

  rows?: number
  placeholder?: string
  textareaClassName?: string

  headerClassName?: string
  titleRowClassName?: string
}) {
  const textareaId = useId()
  return (
    <div className="space-y-2">
      <FieldHeader
        className={props.headerClassName}
        titleRowClassName={props.titleRowClassName}
        htmlFor={textareaId}
        title={props.title}
        required={props.required}
        icon={props.icon}
        codeLabel={props.codeLabel}
        hintText={props.hintText}
        rightSlot={props.rightSlot}
      />

      <TextareaWithChrome
        id={textareaId}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value ?? "")}
        rows={typeof props.rows === "number" ? props.rows : 4}
        className={cn("font-mono text-xs max-h-40 overflow-y-auto resize-none", props.textareaClassName)}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
    </div>
  )
}

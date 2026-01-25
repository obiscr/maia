"use client"

import { useId } from "react"
import type * as React from "react"

import { X } from "lucide-react"

import { FieldHeader } from "@/components/common/field-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export function UploadFilesEditor(props: {
  title: string
  required?: boolean
  icon?: React.ReactNode
  codeLabel?: string | null
  hintText?: string | null
  rightSlot?: React.ReactNode

  files: File[]
  onPickFiles: (picked: File[]) => void
  onRemoveFileAt: (idx: number) => void

  accept?: string
  disabled?: boolean
  disablePick?: boolean

  headerClassName?: string
  titleRowClassName?: string
  chipsWrapClassName?: string
  chipClassName?: string
  removeButtonClassName?: string
  scrollAreaClassName?: string
}) {
  const files = Array.isArray(props.files) ? props.files : []
  const inputId = useId()

  return (
    <div className="space-y-2">
      <FieldHeader
        className={props.headerClassName}
        titleRowClassName={props.titleRowClassName}
        htmlFor={inputId}
        title={props.title}
        required={props.required}
        icon={props.icon}
        codeLabel={props.codeLabel}
        hintText={props.hintText}
        rightSlot={props.rightSlot}
      />

      <div className="space-y-2">
        <Input
          id={inputId}
          type="file"
          multiple
          accept={props.accept}
          disabled={props.disabled || props.disablePick}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])
            // allow picking same file again later
            e.currentTarget.value = ""
            props.onPickFiles(picked)
          }}
        />

        {files.length > 0 ? (
          <ScrollArea className={cn("h-24", props.scrollAreaClassName)}>
            <div className={cn("flex flex-wrap gap-2", props.chipsWrapClassName)}>
              {files.map((f, idx) => (
                <div
                  key={`${f.name}:${f.size}:${idx}`}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/10 px-2 py-1 text-xs transition-colors hover:bg-accent/90 dark:hover:bg-accent/50",
                    props.chipClassName,
                  )}
                >
                  <span className="max-w-[240px] truncate">{f.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "!size-4 shrink-0 rounded-full bg-foreground/10 p-0 text-muted-foreground transition-colors overflow-hidden hover:bg-foreground/20 dark:bg-foreground/15 dark:hover:bg-foreground/30",
                      props.removeButtonClassName,
                    )}
                    onClick={() => props.onRemoveFileAt(idx)}
                    aria-label="Remove file"
                    disabled={props.disabled}
                  >
                    <X className="size-3" strokeWidth={1.5} />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : null}
      </div>
    </div>
  )
}

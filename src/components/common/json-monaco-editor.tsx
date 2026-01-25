"use client"

import * as React from "react"
import type { editor as MonacoEditor } from "monaco-editor"

import { FieldHeader } from "@/components/common/field-header"
import { MaiaMonacoEditor } from "@/components/common/maia-monaco-editor"
import { setupMaiaMonaco, maiaMonacoOptions, MAIA_MONACO_THEME_DARK, MAIA_MONACO_THEME_LIGHT } from "@/lib/client/monaco"
import { cn } from "@/lib/utils"

function useIsDarkTheme() {
  const [isDarkTheme, setIsDarkTheme] = React.useState(false)

  React.useEffect(() => {
    const el = document.documentElement
    const update = () => setIsDarkTheme(el.classList.contains("dark"))
    update()
    const observer = new MutationObserver(() => update())
    observer.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return isDarkTheme
}

export function JsonMonacoEditor(props: {
  title?: string
  required?: boolean
  codeLabel?: string | null
  hintText?: string | null
  icon?: React.ReactNode
  rightSlot?: React.ReactNode
  headerClassName?: string
  titleRowClassName?: string

  value: string
  onChange: (v: string) => void
  disabled?: boolean
  height?: string | number
  className?: string
  editorRef?: React.MutableRefObject<MonacoEditor.IStandaloneCodeEditor | null>
  actions?: React.ReactNode
  showActionsOnHover?: boolean
}) {
  const isDarkTheme = useIsDarkTheme()
  const monacoTheme = isDarkTheme ? MAIA_MONACO_THEME_DARK : MAIA_MONACO_THEME_LIGHT
  const height = props.height ?? 200
  const showOnHover = props.showActionsOnHover ?? true
  const title = typeof props.title === "string" && props.title.trim() ? props.title.trim() : ""
  const showHeader = !!(title || props.codeLabel || props.hintText || props.icon || props.rightSlot)

  return (
    <div className={cn("space-y-2", props.className)}>
      {showHeader ? (
        <FieldHeader
          className={props.headerClassName}
          titleRowClassName={props.titleRowClassName}
          title={title}
          required={props.required}
          icon={props.icon}
          codeLabel={props.codeLabel}
          hintText={props.hintText}
          rightSlot={props.rightSlot}
        />
      ) : null}

      <div className="group relative overflow-hidden rounded-md border border-input bg-transparent shadow-xs">
        {props.actions ? (
          <div
            className={cn(
              "absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-background/85 p-1",
              showOnHover
                ? "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                : "",
            )}
          >
            {props.actions}
          </div>
        ) : null}
        <MaiaMonacoEditor
          height={height}
          defaultLanguage="json"
          theme={monacoTheme}
          value={props.value}
          onChange={(v) => props.onChange(v ?? "")}
          beforeMount={setupMaiaMonaco}
          options={{
            ...maiaMonacoOptions,
            readOnly: !!props.disabled,
          }}
          onMount={(editor) => {
            if (props.editorRef) props.editorRef.current = editor
          }}
        />
      </div>
    </div>
  )
}

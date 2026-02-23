"use client"

import { MaiaMonacoEditor } from "@/components/common/maia-monaco-editor"
import { setupMaiaMonaco, maiaMonacoOptions } from "@/lib/client/monaco"

export default function StepMonacoEditor(props: {
  theme: string
  value: string
  onChange: (value: string | undefined) => void
}) {
  return (
    <MaiaMonacoEditor
      height="100%"
      defaultLanguage="javascript"
      theme={props.theme}
      value={props.value}
      onChange={props.onChange}
      beforeMount={setupMaiaMonaco}
      options={maiaMonacoOptions}
    />
  )
}

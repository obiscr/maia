import type { editor } from "monaco-editor"

import { ensureMaiaJavascriptLanguage } from "@/lib/client/monaco-maia-javascript"

export type Monaco = typeof import("monaco-editor")

export const MAIA_MONACO_THEME_LIGHT = "maia-vs" as const
export const MAIA_MONACO_THEME_DARK = "maia-vs-dark" as const

// Keep in sync with `src/styles/maia/tokens.css`
const MAIA_PRIMARY_LIGHT = "404fec"
const MAIA_PRIMARY_DARK = "b7c6fb"

/**
 * Shared Monaco Editor options.
 *
 * Keep this aligned across all Monaco usages so the gutter/line-numbers/folding
 * and general feel match everywhere (e.g. InputSpec + script editors).
 */
export const maiaMonacoOptions: Readonly<editor.IStandaloneEditorConstructionOptions> = Object.freeze({
  minimap: { enabled: false },
  fontSize: 13,
  tabSize: 2,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  lineNumbers: "on",
  folding: true,
})

let didSetup = false

function ensureMaiaMonacoThemes(monaco: Monaco) {
  monaco.editor.defineTheme(MAIA_MONACO_THEME_LIGHT, {
    base: "vs",
    inherit: true,
    rules: [{ token: "keyword.maia", foreground: MAIA_PRIMARY_LIGHT }],
    colors: {},
  })
  monaco.editor.defineTheme(MAIA_MONACO_THEME_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [{ token: "keyword.maia", foreground: MAIA_PRIMARY_DARK }],
    colors: {},
  })
}

/**
 * Enable Monaco language services / diagnostics in a shared, idempotent way.
 *
 * Notes on performance:
 * - Diagnostics run in web workers (where available).
 * - We default to **syntax-only** checks for JS/TS (semantic/type-check is heavier).
 */
export function setupMaiaMonaco(monaco: Monaco) {
  if (didSetup) return
  didSetup = true

  // Themes must be defined before using `theme="maia-vs"` / `theme="maia-vs-dark"`.
  ensureMaiaMonacoThemes(monaco)

  // Maia JS highlighting (Monarch tokenizer enhancement) for workflow script keywords.
  ensureMaiaJavascriptLanguage(monaco)

  // JSON: syntax validation + basic diagnostics
  try {
    // Use official export namespace: monaco.json.jsonDefaults (NOT languages.json which is deprecated in typings)
    monaco.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      trailingCommas: "error",
      enableSchemaRequest: false,
      schemas: [],
    })
  } catch {
    // ignore
  }

  // JS/TS: syntax diagnostics (semantic/type-check is noticeably heavier)
  try {
    // Use official export namespace: monaco.typescript.javascriptDefaults/typescriptDefaults
    monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSyntaxValidation: false,
      noSemanticValidation: true,
    })
  } catch {
    // ignore
  }
  try {
    monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSyntaxValidation: false,
      noSemanticValidation: true,
    })
  } catch {
    // ignore
  }
}

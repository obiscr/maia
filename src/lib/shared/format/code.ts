export type CodeLanguage = "javascript" | "typescript" | "js" | "ts" | "json" | (string & {})

import hljs from "highlight.js/lib/core"
import javascript from "highlight.js/lib/languages/javascript"
import typescript from "highlight.js/lib/languages/typescript"
import json from "highlight.js/lib/languages/json"

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// Register languages once (core build keeps bundle small).
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("ts", typescript)
hljs.registerLanguage("json", json)

export function highlightCodeHtml(code: string, lang: CodeLanguage = "javascript") {
  const l = String(lang || "").toLowerCase() || "javascript"
  try {
    if (hljs.getLanguage(l)) {
      return hljs.highlight(code ?? "", { language: l, ignoreIllegals: true }).value
    }
    // Unknown language -> escape only (no highlight)
    return escapeHtml(code ?? "")
  } catch {
    return escapeHtml(code ?? "")
  }
}

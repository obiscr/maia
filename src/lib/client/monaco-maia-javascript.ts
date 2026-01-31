import type { Monaco } from "@/lib/client/monaco"

export const MAIA_JAVASCRIPT_LANGUAGE_ID = "maia-javascript" as const

/**
 * Script contract keywords we want to highlight like "real" keywords inside the workflow script editor.
 *
 * Keep this list small/intentional: these are central to the runtime contract and appear everywhere.
 */
export const MAIA_SCRIPT_KEYWORDS = [
  "env",
  "ctx",
  "params",
  "upstream",
  "files",
  "urls",
  "outputs",
  "artifacts",
] as const

let didRegister = false

function escapeRegExpLiteral(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function configureMaiaJavascriptMonarch(monaco: Monaco, targetLanguageId: string) {
  const jsBasic = await import("monaco-editor/esm/vs/basic-languages/javascript/javascript.js")
  const jsLanguage = jsBasic.language
  const jsConf = jsBasic.conf
  if (!jsLanguage || !jsConf) return

  const baseKeywords = Array.isArray(jsLanguage.keywords) ? (jsLanguage.keywords as string[]) : []

  // Highlight Maia runtime contract words with a distinct token type so we can theme them separately
  // from standard JS keywords (e.g. `function`, `return`).
  const maiaKeywordRegex = new RegExp(`\\b(?:${MAIA_SCRIPT_KEYWORDS.map(escapeRegExpLiteral).join("|")})\\b`)
  const jsTokenizer = (jsLanguage as { tokenizer?: { root?: unknown } }).tokenizer
  const root = Array.isArray(jsTokenizer?.root) ? (jsTokenizer.root as unknown[]) : null
  const tokenizer = root ? { ...jsTokenizer, root: [[maiaKeywordRegex, "keyword.maia"], ...root] } : jsTokenizer

  // Keep JS keywords as-is; Maia keywords are handled by the custom rule above.
  const maiaLanguage = { ...jsLanguage, keywords: baseKeywords, tokenizer }
  monaco.languages.setMonarchTokensProvider(targetLanguageId, maiaLanguage as never)
  monaco.languages.setLanguageConfiguration(targetLanguageId, jsConf as never)
}

export function ensureMaiaJavascriptLanguage(monaco: Monaco) {
  // Never touch Monaco language/tokenizer wiring during SSR: monaco-editor basic language modules
  // depend on `window` and will crash on the server if imported/evaluated.
  if (typeof window === "undefined") return
  if (didRegister) return
  didRegister = true

  // 1) Register a dedicated language id (kept for compatibility / future use).
  monaco.languages.register({
    id: MAIA_JAVASCRIPT_LANGUAGE_ID,
    aliases: ["Maia JavaScript", "maiajs"],
    mimetypes: ["text/maia-javascript"],
  })

  // 2) Enhance Monaco's *built-in* JavaScript tokenization so we keep default JS IntelliSense
  // while still highlighting Maia runtime contract words (env/ctx/upstream/etc).
  //
  // This is intentionally a tokenization-only tweak (Monarch). It does NOT replace JS language services.
  void configureMaiaJavascriptMonarch(monaco, "javascript").catch(() => {})

  // 3) Also wire the custom language id to the same tokenization (if used anywhere).
  void configureMaiaJavascriptMonarch(monaco, MAIA_JAVASCRIPT_LANGUAGE_ID).catch(() => {})
}

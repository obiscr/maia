/**
 * Minimal, dependency-free HTML formatter for template editing.
 *
 * Notes:
 * - This is not a full HTML parser. It's intended for simple email template HTML.
 * - It's deterministic and safe to run on save.
 * - It preserves tag order/attributes; normalizes whitespace between nodes.
 */
export function formatHtmlTemplate(input: string): string {
  const html = String(input ?? "")
  const trimmed = html.trim()
  if (!trimmed) return ""

  // Split into tags and text nodes.
  const tokens = trimmed.split(/(<[^>]+>)/g).filter((t) => t !== "")

  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ])

  let indent = 0
  const out: string[] = []

  const indentStr = () => "  ".repeat(Math.max(0, indent))
  const tagName = (tag: string) => {
    const m = tag.match(/^<\s*\/?\s*([a-zA-Z0-9:-]+)/)
    return (m?.[1] ?? "").toLowerCase()
  }
  const isClosing = (tag: string) => /^<\s*\//.test(tag)
  const isSelfClosing = (tag: string) => /\/\s*>$/.test(tag) || voidTags.has(tagName(tag))

  for (const tok of tokens) {
    const isTag = tok.startsWith("<") && tok.endsWith(">")
    if (!isTag) {
      const text = tok.replace(/\s+/g, " ").trim()
      if (text) out.push(`${indentStr()}${text}`)
      continue
    }

    if (isClosing(tok)) indent = Math.max(0, indent - 1)
    out.push(`${indentStr()}${tok.trim()}`)
    if (!isClosing(tok) && !isSelfClosing(tok)) indent += 1
  }

  return out.join("\n").trim() + "\n"
}

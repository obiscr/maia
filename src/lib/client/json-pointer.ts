export function normalizeJsonPointer(path: string | null | undefined): string {
  const raw = String(path ?? "").trim()
  if (!raw) return "/"
  if (raw === "/") return "/"
  return raw.startsWith("/") ? raw : `/${raw}`
}

function decodeJsonPointerSeg(seg: string) {
  // RFC6901: "~1" => "/", "~0" => "~"
  return seg.replace(/~1/g, "/").replace(/~0/g, "~")
}

export function lastJsonPointerSegment(pointer: string | null | undefined): string | null {
  const p = normalizeJsonPointer(pointer)
  if (p === "/") return null
  const segs = p.split("/").slice(1).filter(Boolean)
  if (!segs.length) return null
  return decodeJsonPointerSeg(segs[segs.length - 1]!)
}

export function findJsonPointerInText(text: string, pointer: string): { start: number; end: number } | null {
  const p = normalizeJsonPointer(pointer)
  if (p === "/") return { start: 0, end: 0 }

  const segs = p
    .split("/")
    .slice(1)
    .map((s) => decodeJsonPointerSeg(s))
    .filter(Boolean)
  if (segs.length === 0) return { start: 0, end: 0 }

  let from = 0
  let last: { start: number; end: number } | null = null
  for (const seg of segs) {
    // Best-effort: handle object keys. Array indices are not reliably searchable in raw JSON text.
    if (/^\d+$/.test(seg)) continue
    const quoted = `"${seg.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}"`
    const re = new RegExp(`${quoted}\\s*:`, "g")
    re.lastIndex = from
    const m = re.exec(text)
    if (!m) return null
    const start = m.index + 1 // inside quotes
    const end = start + seg.length
    from = m.index + m[0].length
    // Keep returning the last matched segment, so nested pointers jump near the leaf key.
    last = { start, end }
  }
  return last
}

export function focusJsonPointerInTextarea(textarea: HTMLTextAreaElement | null, pointer: string): boolean {
  if (!textarea) return false
  const text = String(textarea.value ?? "")
  const pos = findJsonPointerInText(text, pointer)
  textarea.focus()
  if (!pos) return false
  try {
    textarea.setSelectionRange(pos.start, pos.end)
  } catch {
    // noop
  }
  return true
}

type MonacoLikeEditor = {
  getModel: () => {
    getValue: () => string
    getPositionAt: (offset: number) => { lineNumber: number; column: number }
  } | null
  setSelection: (sel: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }) => void
  setPosition?: (pos: { lineNumber: number; column: number }) => void
  revealLineInCenter?: (lineNumber: number) => void
  focus: () => void
}

export function parseLineColumnFromMessage(
  message: string | null | undefined,
): { line: number; column: number } | null {
  const raw = String(message ?? "")
  if (!raw) return null

  // Common JSON.parse error formats:
  // - "(line 4 column 2)"
  // - "line 4 column 2"
  const m = raw.match(/\(line\s+(\d+)\s+column\s+(\d+)\)/i) ?? raw.match(/\bline\s+(\d+)\s+column\s+(\d+)\b/i)

  const line = m?.[1] ? Number(m[1]) : null
  const column = m?.[2] ? Number(m[2]) : null
  if (!line || !column) return null
  if (!Number.isFinite(line) || !Number.isFinite(column)) return null
  if (line < 1 || column < 1) return null
  return { line, column }
}

export function focusLineColumnInMonacoEditor(
  editor: MonacoLikeEditor | null,
  line: number,
  column: number,
  opts?: { reveal?: boolean },
): boolean {
  if (!editor) return false
  const model = editor.getModel?.()
  if (!model) return false

  const ln = Math.max(1, Math.floor(line))
  const col = Math.max(1, Math.floor(column))
  editor.focus()
  try {
    editor.setPosition?.({ lineNumber: ln, column: col })
    editor.setSelection({
      startLineNumber: ln,
      startColumn: col,
      endLineNumber: ln,
      endColumn: col,
    })
    if (opts?.reveal !== false) editor.revealLineInCenter?.(ln)
  } catch {
    // noop
  }
  return true
}

function parseJsonErrorPositionFromMessage(message: string | null | undefined): number | null {
  const raw = String(message ?? "")
  if (!raw) return null
  // V8 JSON.parse: "Unexpected token ... in JSON at position 12"
  const m = raw.match(/\bat\s+position\s+(\d+)\b/i) ?? raw.match(/\bposition\s+(\d+)\b/i)
  const pos = m?.[1] ? Number(m[1]) : null
  if (pos == null || !Number.isFinite(pos)) return null
  if (pos < 0) return null
  return pos
}

export function focusJsonParseErrorInMonacoEditor(
  editor: MonacoLikeEditor | null,
  message: string | null | undefined,
): boolean {
  if (!editor) return false
  const model = editor.getModel?.()
  if (!model) return false

  const lc = parseLineColumnFromMessage(message)
  if (lc) return focusLineColumnInMonacoEditor(editor, lc.line, lc.column)

  const pos = parseJsonErrorPositionFromMessage(message)
  if (pos != null) {
    try {
      const p = model.getPositionAt(pos)
      return focusLineColumnInMonacoEditor(editor, p.lineNumber, p.column)
    } catch {
      // noop
    }
  }

  // Fallback: focus editor but don't move selection.
  editor.focus()
  return false
}

export function focusJsonPointerInMonacoEditor(editor: MonacoLikeEditor | null, pointer: string): boolean {
  if (!editor) return false
  const model = editor.getModel?.()
  if (!model) return false
  const text = String(model.getValue?.() ?? "")
  const pos = findJsonPointerInText(text, pointer)
  editor.focus()
  if (!pos) return false
  try {
    const start = model.getPositionAt(pos.start)
    const end = model.getPositionAt(pos.end)
    editor.setSelection({
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    })
    editor.revealLineInCenter?.(start.lineNumber)
  } catch {
    // noop
  }
  return true
}

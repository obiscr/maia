// Client-side download helpers (standardize blob/file downloads).

function stripControlChars(input: string) {
  let out = ""
  for (const ch of input) {
    const code = ch.codePointAt(0)
    if (code == null) continue
    // ASCII control chars + DEL.
    if (code <= 0x1f || code === 0x7f) continue
    out += ch
  }
  return out
}

function sanitizeFilename(name: string, fallback = "download") {
  const raw = String(name || "").trim()
  const cleaned = stripControlChars(raw.replaceAll(/[/\\]/g, "-")).trim()
  return cleaned || fallback
}

function parseContentDispositionFilename(header: string | null): string | null {
  const h = header ? String(header) : ""
  if (!h) return null

  // RFC 5987: filename*=UTF-8''...
  const star = /filename\*\s*=\s*([^;]+)/i.exec(h)
  if (star?.[1]) {
    const v = star[1].trim()
    const m = /^(?:UTF-8''|utf-8'')(.+)$/.exec(v)
    const encoded = m?.[1] ?? v
    try {
      return decodeURIComponent(encoded.replace(/^"(.*)"$/, "$1"))
    } catch {
      return encoded.replace(/^"(.*)"$/, "$1")
    }
  }

  // filename="..."
  const plain = /filename\s*=\s*("?)([^";]+)\1/i.exec(h)
  if (plain?.[2]) return plain[2].trim()
  return null
}

export function downloadBlob(opts: { blob: Blob; filename?: string | null }) {
  const blob = opts.blob
  const filename = sanitizeFilename(opts.filename ?? "download")

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Delay revocation to avoid Safari timing issues.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function downloadFromResponse(res: Response, opts?: { fallbackFilename?: string | null }) {
  const blob = await res.blob()
  const headerName = parseContentDispositionFilename(res.headers.get("Content-Disposition"))
  const filename = headerName ?? opts?.fallbackFilename ?? "download"
  downloadBlob({ blob, filename })
}

import "server-only"

export { safeJsonParseObject, safeJsonStringify } from "@/lib/shared/lang/safe-json"

export function linesFromChunk(chunk: Buffer, carry: { buf: string }) {
  carry.buf += chunk.toString("utf8")
  const out: string[] = []
  while (true) {
    const idx = carry.buf.indexOf("\n")
    if (idx < 0) break
    const line = carry.buf.slice(0, idx)
    carry.buf = carry.buf.slice(idx + 1)
    out.push(line.replace(/\r$/, ""))
  }
  return out
}

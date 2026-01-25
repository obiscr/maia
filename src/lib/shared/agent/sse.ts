export function sseEncode(params: { id?: number; event: string; data: unknown }) {
  const lines: string[] = []
  if (typeof params.id === "number") lines.push(`id: ${params.id}`)
  lines.push(`event: ${params.event}`)
  lines.push(`data: ${JSON.stringify(params.data)}`)
  return lines.join("\n") + "\n\n"
}

export function parseSseChunk(buf: string) {
  const events: Array<{ event: string; data: unknown }> = []
  const parts = buf.split("\n\n")
  const rest = parts.pop() ?? ""
  for (const part of parts) {
    const lines = part.split("\n")
    let ev = "message"
    let dataStr = ""
    for (const raw of lines) {
      const line = raw.trimEnd()
      if (line.startsWith("event:")) ev = line.slice("event:".length).trim()
      if (line.startsWith("data:")) dataStr += line.slice("data:".length).trim()
    }
    if (!dataStr) continue
    try {
      events.push({ event: ev, data: JSON.parse(dataStr) })
    } catch {
      events.push({ event: ev, data: dataStr })
    }
  }
  return { events, rest }
}

export function parseUpstreamSseLines(buf: string) {
  const events: Array<{ data: string }> = []
  const parts = buf.split("\n\n")
  const rest = parts.pop() ?? ""
  for (const part of parts) {
    const lines = part.split("\n").map((l) => l.trimEnd())
    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const data = line.slice("data:".length).trim()
      if (!data) continue
      events.push({ data })
    }
  }
  return { events, rest }
}

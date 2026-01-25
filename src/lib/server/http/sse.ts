import "server-only"

import { NextResponse } from "next/server"

import { parseSseFromIdParts } from "@/lib/server/http/sse-utils"

export function parseSseFromId(req: Request, url: URL) {
  const lastIdHeader = req.headers.get("last-event-id") ?? req.headers.get("Last-Event-ID")
  return parseSseFromIdParts({
    queryFromId: url.searchParams.get("fromId"),
    lastEventIdHeader: lastIdHeader,
  })
}

export function sseResponse(stream: ReadableStream) {
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

import { getRequestStore, withApiObservability } from "@/lib/server/observability"
import { parseSseFromId, sseResponse } from "@/lib/server/http/sse"
import { topicEventBus } from "@/lib/server/realtime/bus"
import {
  recordStreamClose,
  recordStreamError,
  recordStreamOpen,
  recordStreamReplayed,
  recordStreamSent,
} from "@/lib/server/realtime/topic-stream-metrics"
import { findStreamEventById, getLatestStreamEventId, replayStreamEvents } from "@/lib/server/realtime/store"
import { sseEncode } from "@/lib/shared/agent/sse"
import { requireRequestAuth } from "@/lib/server/authz"
import { assertCanSubscribe, StreamAuthorizationError } from "@/lib/server/scopes/stream-authorization"
import { isKnownStreamTopicKind, parseStreamTopic, type StreamTopic } from "@/lib/shared/realtime/topics"

export const runtime = "nodejs"

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()

  const url = new URL(req.url)
  const topicRaw = url.searchParams.get("topic") ?? ""
  const parsed = parseStreamTopic(topicRaw)
  if (!parsed) return new Response("Invalid topic", { status: 400 })
  if (!isKnownStreamTopicKind(parsed.kind)) return new Response("Invalid topic", { status: 400 })
  const topic: StreamTopic = parsed.topic

  try {
    await assertCanSubscribe(auth, parsed)
  } catch (e) {
    if (e instanceof StreamAuthorizationError) return new Response(e.message, { status: e.status })
    throw e
  }

  const { fromId: rawFromId, headerFromId, queryFromId } = parseSseFromId(req, url)
  const fromParam = String(url.searchParams.get("from") ?? "")
    .trim()
    .toLowerCase()
  const replayParam = String(url.searchParams.get("replay") ?? "")
    .trim()
    .toLowerCase()
  const wantsTail = fromParam === "latest" || replayParam === "none"

  // Capture request id before `withApiObservability` ends the request store (SSE stays open).
  const rid = getRequestStore()?.id ?? null

  const clientSession = url.searchParams.get("clientSession") ?? null
  const clientAttemptRaw = url.searchParams.get("clientAttempt")
  const clientAttempt = clientAttemptRaw ? Number(clientAttemptRaw) : 0
  const safeAttempt = Number.isFinite(clientAttempt) && clientAttempt > 0 ? Math.floor(clientAttempt) : 0

  // Shared stream lifecycle (ReadableStream.start/cancel run in separate callbacks).
  let closed = false
  let startedAt = Date.now()
  let keepalive: ReturnType<typeof setInterval> | null = null
  let pollTmr: ReturnType<typeof setInterval> | null = null
  let maxAgeTmr: ReturnType<typeof setTimeout> | null = null
  let unsub: null | (() => void) = null
  let lastSentId = 0
  let fromId = rawFromId

  const log = (line: string) => {
    const prefix = `[sse] /api/stream`
    const base = `${prefix} topic=${topic} rid=${rid ?? "-"}`
    const client = clientSession ? ` clientSession=${clientSession}` : ""
    const attempt = safeAttempt ? ` clientAttempt=${safeAttempt}` : ""
    console.info(`${base}${client}${attempt} ${line}`)
  }

  const cleanup = (reason: "abort" | "cancel" | "max_age" | "enqueue_failed" | "start_failed") => {
    if (closed) return
    closed = true
    if (keepalive) clearInterval(keepalive)
    if (pollTmr) clearInterval(pollTmr)
    if (maxAgeTmr) clearTimeout(maxAgeTmr)
    try {
      unsub?.()
    } catch {}
    recordStreamClose(reason)
    log(`close reason=${reason} ageMs=${Date.now() - startedAt}`)
  }

  const stream = new ReadableStream({
    start: async (controller) => {
      recordStreamOpen()

      startedAt = Date.now()

      const safeEnqueue = (chunk: string) => {
        try {
          controller.enqueue(chunk)
          return true
        } catch {
          return false
        }
      }

      const send = (id: number | undefined, event: string, data: unknown) => {
        const ok = safeEnqueue(sseEncode({ id, event, data }))
        if (ok && id) recordStreamSent(1)
        if (!ok) {
          recordStreamError()
          cleanup("enqueue_failed")
          try {
            controller.close()
          } catch {}
        }
      }

      // Flush an initial byte ASAP so browsers consider the SSE connection "open"
      // even when there are no replayed events yet.
      // (Some clients won't fire `EventSource.onopen` until the first chunk arrives.)
      safeEnqueue(`: open ${Date.now()}\n\n`)

      // Initial replay.
      const keepaliveEveryMs = 15_000
      const maxConnectionMs = 30 * 60_000 // rotate connections to avoid pathological long-lived leaks
      const pollEveryMs = 500

      keepalive = setInterval(() => {
        // Comment ping (doesn't surface to client handlers but keeps intermediaries warm).
        safeEnqueue(`: ping ${Date.now()}\n\n`)
      }, keepaliveEveryMs)

      maxAgeTmr = setTimeout(() => {
        cleanup("max_age")
        try {
          controller.close()
        } catch {}
      }, maxConnectionMs)

      // If requested, tail (skip history) on first connect only.
      // If the client provided a cursor (via Last-Event-ID or fromId), we always respect it.
      if (wantsTail && fromId === 0) {
        fromId = await getLatestStreamEventId(topic).catch(() => 0)
      }

      log(
        `open fromId=${fromId} headerFromId=${headerFromId} queryFromId=${queryFromId} replayTake=2000` +
          (wantsTail ? ` mode=tail` : ""),
      )

      try {
        const rows = await replayStreamEvents({ topic, fromId, take: 2000 })
        recordStreamReplayed(rows.length)
        if (rows.length) log(`replay count=${rows.length} range=${rows[0]!.id}..${rows[rows.length - 1]!.id}`)
        else log(`replay count=0`)

        for (const row of rows) {
          let data: unknown = null
          try {
            data = JSON.parse(String(row.dataJson ?? "null"))
          } catch {
            data = null
          }
          send(row.id, "message", {
            id: row.id,
            topic,
            type: String(row.event ?? ""),
            data,
            ts: row.createdAt?.toISOString?.(),
          })
        }

        // Track cursor so we can poll/skip duplicates even when producers run in a different process
        // (in-memory bus won't reach this SSE handler in that case).
        lastSentId = rows.length ? rows[rows.length - 1]!.id : fromId
      } catch (e) {
        recordStreamError()
        log(`start_error detail=${e instanceof Error ? e.message : String(e)}`)
        cleanup("start_failed")
        try {
          controller.close()
        } catch {}
        return
      }

      unsub = topicEventBus.subscribe(topic, async (busEv) => {
        if (busEv.type !== "stream_event") return
        const row = await findStreamEventById(busEv.id)
        if (!row || row.topic !== topic) return
        if (row.id <= lastSentId) return
        let data: unknown = null
        try {
          data = JSON.parse(String(row.dataJson ?? "null"))
        } catch {
          data = null
        }
        send(row.id, "message", {
          id: row.id,
          topic,
          type: String(row.event || ""),
          data,
          ts: row.createdAt.toISOString(),
        })
        lastSentId = row.id
      })

      // Fallback polling: makes streams live even when producers are in a different Node process/worker.
      // (topicEventBus is in-memory and doesn't cross process boundaries.)
      pollTmr = setInterval(() => {
        void (async () => {
          if (closed) return
          const cur = lastSentId
          if (!Number.isFinite(cur) || cur < 0) return
          const rows = await replayStreamEvents({ topic, fromId: Math.floor(cur), take: 2000 }).catch(() => [])
          if (!rows.length) return
          for (const row of rows) {
            if (row.id <= lastSentId) continue
            let data: unknown = null
            try {
              data = JSON.parse(String(row.dataJson ?? "null"))
            } catch {
              data = null
            }
            send(row.id, "message", {
              id: row.id,
              topic,
              type: String(row.event ?? ""),
              data,
              ts: row.createdAt?.toISOString?.(),
            })
            lastSentId = row.id
          }
        })()
      }, pollEveryMs)

      const onAbort = () => {
        cleanup("abort")
        try {
          controller.close()
        } catch {}
      }
      if (req.signal.aborted) onAbort()
      req.signal.addEventListener("abort", onAbort, { once: true })
    },
    cancel: () => {
      // The client disconnected; `req.signal` is not guaranteed to fire in all environments.
      cleanup("cancel")
    },
  })

  return sseResponse(stream)
})

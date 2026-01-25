"use client"

import type { StreamTopic } from "@/lib/shared/realtime/topics"
import { backoffMs } from "@/lib/client/realtime/backoff"

export type TopicStreamMessage = {
  id?: number
  topic: StreamTopic
  type: string
  data: unknown
  ts?: string
}

type StatusListener = (connected: boolean) => void
type MessageListener = (msg: TopicStreamMessage) => void

type PoolKey = string

function safeSessionStorageGet(key: string) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSessionStorageSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // ignore (e.g. private mode)
  }
}

function getClientSessionId(): string {
  const key = "maia.sseClientSession"
  const existing = safeSessionStorageGet(key)
  if (existing && existing.trim()) return existing
  const id = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  safeSessionStorageSet(key, id)
  return id
}

class TopicStreamConnection {
  readonly topic: StreamTopic
  readonly cursorKey: string
  readonly key: PoolKey
  readonly maxRetries: number
  readonly persistCursor: boolean
  readonly extraParams: Record<string, string>

  private es: EventSource | null = null
  private connected = false
  private closed = false
  private connectAttempt = 0
  private reconnectTmr: number | null = null

  private statusSubs = new Set<StatusListener>()
  private msgSubs = new Set<MessageListener>()

  constructor(params: {
    topic: StreamTopic
    cursorKey: string
    key: PoolKey
    maxRetries: number
    persistCursor: boolean
    extraParams?: Record<string, string>
  }) {
    this.topic = params.topic
    this.cursorKey = params.cursorKey
    this.key = params.key
    this.maxRetries = params.maxRetries
    this.persistCursor = params.persistCursor
    this.extraParams = params.extraParams ?? {}
  }

  subscribeStatus(fn: StatusListener) {
    this.statusSubs.add(fn)
    fn(this.connected)
    return () => this.statusSubs.delete(fn)
  }

  subscribeMessage(fn: MessageListener) {
    this.msgSubs.add(fn)
    return () => this.msgSubs.delete(fn)
  }

  start() {
    if (this.closed) return
    if (this.es) return
    this.open()
  }

  stop() {
    this.closed = true
    if (this.reconnectTmr) window.clearTimeout(this.reconnectTmr)
    this.reconnectTmr = null
    this.closeEventSource()
    this.setConnected(false)
  }

  private setConnected(v: boolean) {
    if (this.connected === v) return
    this.connected = v
    for (const fn of this.statusSubs) fn(v)
  }

  private closeEventSource() {
    if (!this.es) return
    try {
      this.es.close()
    } catch {
      // ignore
    }
    this.es = null
  }

  private buildUrl(attempt: number) {
    let url = `/api/stream?topic=${encodeURIComponent(String(this.topic))}`
    const clientSession = getClientSessionId()
    url += `&clientSession=${encodeURIComponent(clientSession)}`
    url += `&clientAttempt=${encodeURIComponent(String(attempt))}`

    const explicitFromIdRaw = this.extraParams?.fromId
    for (const [k, v] of Object.entries(this.extraParams)) {
      if (!k) continue
      if (k === "fromId") continue
      const val = String(v ?? "")
      if (!val.length) continue
      url += `&${encodeURIComponent(String(k))}=${encodeURIComponent(val)}`
    }

    const explicitFromId = explicitFromIdRaw ? Number(explicitFromIdRaw) : 0
    if (Number.isFinite(explicitFromId) && explicitFromId > 0) {
      url += `&fromId=${encodeURIComponent(String(Math.floor(explicitFromId)))}`
    } else if (this.persistCursor) {
      const raw = safeSessionStorageGet(this.cursorKey)
      const n = raw ? Number(raw) : 0
      if (Number.isFinite(n) && n > 0) url += `&fromId=${encodeURIComponent(String(n))}`
    }
    return url
  }

  private open() {
    if (this.closed) return
    if (this.es) return

    this.connectAttempt += 1
    const attempt = this.connectAttempt
    const url = this.buildUrl(attempt)

    const es = new EventSource(url)
    this.es = es
    this.setConnected(false)

    const onMessage = (ev: MessageEvent) => {
      let payload: TopicStreamMessage | null = null
      try {
        payload = JSON.parse(String(ev.data || "")) as TopicStreamMessage
      } catch {
        payload = null
      }
      if (!payload || !payload.type) return

      // Persist cursor using SSE id (Last-Event-ID is exposed as ev.lastEventId).
      const rawId = ev.lastEventId
      const parsedId = rawId ? Number(rawId) : NaN
      const id = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null
      if (this.persistCursor && id) safeSessionStorageSet(this.cursorKey, String(id))

      for (const fn of this.msgSubs) fn(payload)
    }

    const onOpen = () => {
      this.setConnected(true)
      this.connectAttempt = 0
    }

    const onError = () => {
      // EventSource auto-reconnects; we want controlled backoff, so we close & reschedule.
      this.setConnected(false)
      this.closeEventSource()

      if (this.closed) return
      const nextAttempt = this.connectAttempt + 1
      if (nextAttempt > this.maxRetries) return

      const delay = backoffMs(nextAttempt, { baseMs: 500, maxMs: 30_000, jitterRatio: 0.25 })
      if (this.reconnectTmr) window.clearTimeout(this.reconnectTmr)
      this.reconnectTmr = window.setTimeout(() => {
        this.reconnectTmr = null
        this.open()
      }, delay)
    }

    // Server always sends `event: message`, and embeds the logical type in payload.type.
    es.onopen = onOpen
    es.onerror = onError
    es.onmessage = onMessage
  }
}

class TopicStreamPool {
  private conns = new Map<PoolKey, { conn: TopicStreamConnection; refs: number }>()

  acquire(params: {
    topic: StreamTopic
    cursorKey: string
    maxRetries: number
    persistCursor?: boolean
    extraParams?: Record<string, string>
  }) {
    const persistCursor = params.persistCursor !== false
    const stableExtras = (() => {
      const entries = Object.entries(params.extraParams ?? {})
        .filter(([k]) => !!k)
        .map(([k, v]) => [String(k), String(v ?? "")] as const)
        .filter(([, v]) => v.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
      if (!entries.length) return ""
      return `|q:${entries.map(([k, v]) => `${k}=${v}`).join("&")}`
    })()
    const key = `${params.topic}|${params.cursorKey}|p:${persistCursor ? 1 : 0}${stableExtras}` as PoolKey
    const existing = this.conns.get(key)
    if (existing) {
      existing.refs += 1
      existing.conn.start()
      return existing.conn
    }
    const conn = new TopicStreamConnection({
      topic: params.topic,
      cursorKey: params.cursorKey,
      key,
      maxRetries: params.maxRetries,
      persistCursor,
      extraParams: params.extraParams,
    })
    this.conns.set(key, { conn, refs: 1 })
    conn.start()
    return conn
  }

  release(conn: TopicStreamConnection) {
    const cur = this.conns.get(conn.key)
    if (!cur) return
    cur.refs -= 1
    if (cur.refs > 0) return
    this.conns.delete(conn.key)
    conn.stop()
  }
}

declare global {
  // Persist across Next.js dev HMR reloads within the same browser tab.
  var __maiaTopicStreamPool: TopicStreamPool | undefined
}

export const topicStreamPool: TopicStreamPool = globalThis.__maiaTopicStreamPool ?? new TopicStreamPool()

if (process.env.NODE_ENV !== "production") {
  globalThis.__maiaTopicStreamPool = topicStreamPool
}

"use client"

import * as React from "react"

import type { StreamTopic } from "@/lib/shared/realtime/topics"
import { topicStreamPool, type TopicStreamMessage } from "@/lib/client/realtime/topic-stream-pool"

export function useTopicStream(params: {
  topic: StreamTopic | null
  enabled?: boolean
  /**
   * Optional stable key used for cursor persistence (sessionStorage).
   * Defaults to `maia.topicCursor:${topic}`.
   */
  cursorKey?: string
  /**
   * Whether to persist SSE cursor (Last-Event-ID) in sessionStorage and send it back as `fromId`.
   *
   * - true (default): good for "infinite" topics like `jobs:list` where you want to resume.
   * - false: good for "finite/history" topics like `run:<id>` where you always want a fresh replay,
   *   otherwise the page can look empty once the run is completed.
   */
  persistCursor?: boolean
  /**
   * Extra query params to append to `/api/stream`.
   * Use for protocol-level behavior toggles (e.g. `from=latest`, `replay=none`).
   */
  extraParams?: Record<string, string>
  onMessage?: (msg: TopicStreamMessage) => void
}) {
  const enabled = params.enabled !== false && !!params.topic
  const topic = params.topic
  const cursorKey = params.cursorKey ?? (topic ? `maia.topicCursor:${topic}` : "maia.topicCursor:null")
  const persistCursor = params.persistCursor !== false
  const extraParamsEntries = Object.entries(params.extraParams ?? {})
    .filter(([k]) => !!String(k || "").trim())
    .map(([k, v]) => [String(k), String(v ?? "")] as const)
    .filter(([, v]) => v.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
  const extraParamsKey = extraParamsEntries.map(([k, v]) => `${k}=${v}`).join("&")
  const extraParams = React.useMemo(() => Object.fromEntries(extraParamsEntries), [extraParamsKey])
  const onMessageRef = React.useRef(params.onMessage)
  React.useEffect(() => {
    onMessageRef.current = params.onMessage
  }, [params.onMessage])

  const connRef = React.useRef<ReturnType<typeof topicStreamPool.acquire> | null>(null)
  const [connected, setConnected] = React.useState(false)

  React.useEffect(() => {
    setConnected(false)
  }, [topic])

  React.useEffect(() => {
    // Cleanup previous subscription when toggling/disabling.
    if (!enabled || !topic) {
      if (connRef.current) {
        topicStreamPool.release(connRef.current)
        connRef.current = null
      }
      setConnected(false)
      return
    }

    if (connRef.current) {
      topicStreamPool.release(connRef.current)
      connRef.current = null
    }

    const conn = topicStreamPool.acquire({ topic, cursorKey, maxRetries: 8, persistCursor, extraParams })
    connRef.current = conn
    const unsubStatus = conn.subscribeStatus(setConnected)
    const unsubMsg = conn.subscribeMessage((msg: TopicStreamMessage) => onMessageRef.current?.(msg))

    return () => {
      unsubStatus()
      unsubMsg()
      if (connRef.current) {
        topicStreamPool.release(connRef.current)
        connRef.current = null
      }
    }
  }, [cursorKey, enabled, extraParamsKey, persistCursor, topic])

  return { connected }
}

import "server-only"

type CloseReason = "abort" | "cancel" | "max_age" | "enqueue_failed" | "start_failed"

type TopicStreamMetrics = {
  active: number
  opened: number
  closed: number
  errors: number
  replayedEvents: number
  sentEvents: number
  closeReasons: Record<CloseReason, number>
}

function makeMetrics(): TopicStreamMetrics {
  return {
    active: 0,
    opened: 0,
    closed: 0,
    errors: 0,
    replayedEvents: 0,
    sentEvents: 0,
    closeReasons: { abort: 0, cancel: 0, max_age: 0, enqueue_failed: 0, start_failed: 0 },
  }
}

declare global {
  var __maiaTopicStreamMetrics: TopicStreamMetrics | undefined
}

export const topicStreamMetrics: TopicStreamMetrics = globalThis.__maiaTopicStreamMetrics ?? makeMetrics()

if (process.env.NODE_ENV !== "production") {
  globalThis.__maiaTopicStreamMetrics = topicStreamMetrics
}

export function recordStreamOpen() {
  topicStreamMetrics.opened += 1
  topicStreamMetrics.active += 1
}

export function recordStreamClose(reason: CloseReason) {
  topicStreamMetrics.closed += 1
  topicStreamMetrics.active = Math.max(0, topicStreamMetrics.active - 1)
  topicStreamMetrics.closeReasons[reason] = (topicStreamMetrics.closeReasons[reason] ?? 0) + 1
}

export function recordStreamError() {
  topicStreamMetrics.errors += 1
}

export function recordStreamReplayed(n: number) {
  if (!Number.isFinite(n) || n <= 0) return
  topicStreamMetrics.replayedEvents += Math.floor(n)
}

export function recordStreamSent(n: number) {
  if (!Number.isFinite(n) || n <= 0) return
  topicStreamMetrics.sentEvents += Math.floor(n)
}

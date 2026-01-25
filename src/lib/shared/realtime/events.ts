import type { StreamTopic } from "@/lib/shared/realtime/topics"

/**
 * Generic stream event payload envelope used by the topic-based realtime system.
 * - `topic` scopes the event (e.g. "batch:<id>", "job:<id>").
 * - `type` is the logical event name (SSE uses it as the `event:` field).
 * - `ts` is ISO timestamp for display/debug (server-generated).
 */
export type TopicStreamEvent<TType extends string = string, TData = unknown> = {
  topic: StreamTopic
  type: TType
  data: TData
  ts?: string
}

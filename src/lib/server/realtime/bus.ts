import "server-only"

export type TopicBusEvent = { type: "stream_event"; id: number } | { type: "tick" }

class TopicEventBus {
  private subs = new Map<string, Set<(ev: TopicBusEvent) => void>>()

  subscribe(topic: string, fn: (ev: TopicBusEvent) => void) {
    let set = this.subs.get(topic)
    if (!set) {
      set = new Set()
      this.subs.set(topic, set)
    }
    set.add(fn)
    return () => {
      set?.delete(fn)
      if (set && set.size === 0) this.subs.delete(topic)
    }
  }

  emit(topic: string, ev: TopicBusEvent) {
    const set = this.subs.get(topic)
    if (!set) return
    for (const fn of set) fn(ev)
  }
}

declare global {
  // Persist across Next.js dev HMR reloads within the same Node process.
  var __maiaTopicEventBus: TopicEventBus | undefined
}

export const topicEventBus: TopicEventBus = globalThis.__maiaTopicEventBus ?? new TopicEventBus()

if (process.env.NODE_ENV !== "production") {
  globalThis.__maiaTopicEventBus = topicEventBus
}

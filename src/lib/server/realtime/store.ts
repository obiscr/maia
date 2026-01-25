import "server-only"

import { prisma } from "@/lib/server/db"
import { topicEventBus } from "@/lib/server/realtime/bus"
import type { StreamTopic } from "@/lib/shared/realtime/topics"

export type StreamEventRow = {
  id: number
  topic: string
  event: string
  dataJson: string
  createdAt: Date
}

export async function appendStreamEvent<T>(params: { topic: StreamTopic; event: string; data: T }) {
  const row = await prisma.streamEvent.create({
    data: {
      topic: params.topic,
      event: params.event,
      dataJson: JSON.stringify(params.data ?? null),
    },
  })
  topicEventBus.emit(params.topic, { type: "stream_event", id: row.id })
  return row
}

export async function findStreamEventById(id: number): Promise<StreamEventRow | null> {
  const row = await prisma.streamEvent.findUnique({ where: { id } })
  return row
}

export async function replayStreamEvents(params: {
  topic: StreamTopic
  fromId: number
  take: number
}): Promise<StreamEventRow[]> {
  const take = Math.max(1, Math.min(10_000, Math.floor(params.take)))
  const fromId = Number.isFinite(params.fromId) && params.fromId > 0 ? Math.floor(params.fromId) : 0

  if (fromId === 0) {
    // First-time connects: send the most recent chunk so UIs quickly converge.
    const latest = await prisma.streamEvent.findMany({
      where: { topic: params.topic },
      orderBy: [{ id: "desc" }],
      take,
    })
    return latest.reverse()
  }

  return await prisma.streamEvent.findMany({
    where: { topic: params.topic, id: { gt: fromId } },
    orderBy: [{ id: "asc" }],
    take,
  })
}

export async function getLatestStreamEventId(topic: StreamTopic): Promise<number> {
  const row = await prisma.streamEvent.findFirst({
    where: { topic },
    orderBy: [{ id: "desc" }],
    select: { id: true },
  })
  return row?.id ?? 0
}

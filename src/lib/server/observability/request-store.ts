import "server-only"

import { AsyncLocalStorage } from "async_hooks"
import crypto from "crypto"
import { performance } from "perf_hooks"

export type DbQueryStat = {
  model?: string
  action: string
  ms: number
}

export type RequestStore = {
  id: string
  startMs: number
  marks: Array<{ name: string; ms: number }>
  auth?: {
    userId: string
    publicId: string
    role: string
  }
  db: {
    totalMs: number
    count: number
    slowestMs: number
    slowest?: DbQueryStat
  }
}

const als = new AsyncLocalStorage<RequestStore>()

export function runWithRequestStore<T>(fn: () => Promise<T>, seed?: Partial<Pick<RequestStore, "id">>) {
  const store: RequestStore = {
    id: seed?.id ?? crypto.randomUUID(),
    startMs: performance.now(),
    marks: [],
    db: { totalMs: 0, count: 0, slowestMs: 0 },
  }
  return als.run(store, fn)
}

export function getRequestStore() {
  return als.getStore() ?? null
}

export function setRequestAuth(auth: RequestStore["auth"] | null) {
  const s = getRequestStore()
  if (!s) return
  if (!auth) delete s.auth
  else s.auth = auth
}

export function getRequestAuth() {
  const s = getRequestStore()
  return s?.auth ?? null
}

export function mark(name: string) {
  const s = getRequestStore()
  if (!s) return
  s.marks.push({ name, ms: performance.now() - s.startMs })
}

export function recordDbQuery(stat: DbQueryStat) {
  const s = getRequestStore()
  if (!s) return
  s.db.count += 1
  s.db.totalMs += stat.ms
  if (stat.ms >= s.db.slowestMs) {
    s.db.slowestMs = stat.ms
    s.db.slowest = stat
  }
}

export function endRequestStore() {
  const s = getRequestStore()
  if (!s) return null
  const total = performance.now() - s.startMs
  return { store: s, total }
}

"use client"

import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

export type WorkflowLayoutPresetKey = "CUSTOM" | "LR" | "TB"

export type WorkflowLayoutPoint = { x: number; y: number }

export type WorkflowLayoutPreset = {
  // Map stepKey -> position (ReactFlow node position).
  positions: Record<string, WorkflowLayoutPoint>
  updatedAt: string
  // Signature of the workflow structure when this preset was created (e.g. stepKey->deps hash/string).
  layoutSig?: string
}

// Per-product requirement: when selection is the default (LR), we omit it from storage.
type WorkflowLayoutEntryStored = {
  selected?: WorkflowLayoutPresetKey
  presets?: Partial<Record<WorkflowLayoutPresetKey, WorkflowLayoutPreset>>
}

export type WorkflowLayoutEntry = {
  // Computed selection; if not stored, defaults to LR.
  selected: WorkflowLayoutPresetKey
  presets: Partial<Record<WorkflowLayoutPresetKey, WorkflowLayoutPreset>>
}

// Per request: store as an array of objects: [{ [workflowId]: entry }, ...]
export type WorkflowLayoutStore = Array<Record<string, WorkflowLayoutEntryStored>>

const LS_KEY = "maia.workflows.layouts.v1"
const DEFAULT_PRESET: WorkflowLayoutPresetKey = "LR"

function safeReadLocalStorageJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function safeWriteLocalStorageJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

function normalizePoint(p: unknown): WorkflowLayoutPoint | null {
  if (!isPlainObject(p)) return null
  const x = Number(p.x)
  const y = Number(p.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function normalizePreset(p: unknown): WorkflowLayoutPreset | null {
  if (!isPlainObject(p)) return null
  const positionsRaw = p.positions
  if (!isPlainObject(positionsRaw)) return null
  const positions: Record<string, WorkflowLayoutPoint> = {}
  for (const [k, v] of Object.entries(positionsRaw)) {
    const pt = normalizePoint(v)
    if (!pt) continue
    positions[String(k)] = pt
  }
  const updatedAt = typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString()
  const layoutSig = typeof p.layoutSig === "string" ? p.layoutSig : undefined
  return { positions, updatedAt, layoutSig }
}

function normalizeEntryStored(e: unknown): WorkflowLayoutEntryStored | null {
  if (!isPlainObject(e)) return null
  const selectedRaw = e.selected
  const selected: WorkflowLayoutPresetKey | undefined =
    selectedRaw === "CUSTOM" || selectedRaw === "TB" || selectedRaw === "LR" ? selectedRaw : undefined

  const presetsRaw = e.presets
  const presets: NonNullable<WorkflowLayoutEntryStored["presets"]> = {}
  if (isPlainObject(presetsRaw)) {
    for (const k of ["CUSTOM", "LR", "TB"] as const) {
      const pr = normalizePreset(presetsRaw[k])
      if (pr) presets[k] = pr
    }
  }

  const out: WorkflowLayoutEntryStored = {}
  // Omit default selected.
  if (selected && selected !== DEFAULT_PRESET) out.selected = selected
  if (Object.keys(presets).length) out.presets = presets
  return out
}

export function loadWorkflowLayoutStore(): WorkflowLayoutStore {
  if (typeof window === "undefined") return []
  const raw = safeReadLocalStorageJson(LS_KEY)
  if (!Array.isArray(raw)) return []
  const out: WorkflowLayoutStore = []
  for (const item of raw) {
    if (!isPlainObject(item)) continue
    const obj: Record<string, WorkflowLayoutEntryStored> = {}
    for (const [wid, entryRaw] of Object.entries(item)) {
      const entry = normalizeEntryStored(entryRaw)
      if (!entry) continue
      obj[String(wid)] = entry
    }
    if (Object.keys(obj).length) out.push(obj)
  }
  return out
}

export function saveWorkflowLayoutStore(store: WorkflowLayoutStore) {
  if (typeof window === "undefined") return
  safeWriteLocalStorageJson(LS_KEY, store)
}

function getWorkflowLayoutEntryStored(workflowId: string): WorkflowLayoutEntryStored | null {
  const store = loadWorkflowLayoutStore()
  for (const obj of store) {
    const hit = obj[workflowId]
    if (hit) return hit
  }
  return null
}

export function getWorkflowLayoutEntry(workflowId: string): WorkflowLayoutEntry | null {
  const stored = getWorkflowLayoutEntryStored(workflowId)
  if (!stored) return null
  return {
    selected: stored.selected ?? DEFAULT_PRESET,
    presets: stored.presets ?? {},
  }
}

function upsertWorkflowLayoutEntryStored(workflowId: string, entry: WorkflowLayoutEntryStored) {
  const store = loadWorkflowLayoutStore()
  let didUpdate = false
  const next: WorkflowLayoutStore = store.map((obj) => {
    if (Object.prototype.hasOwnProperty.call(obj, workflowId)) {
      didUpdate = true
      return { ...obj, [workflowId]: entry }
    }
    return obj
  })
  if (!didUpdate) next.push({ [workflowId]: entry })
  saveWorkflowLayoutStore(next)
}

export function deleteWorkflowLayoutEntry(workflowId: string) {
  const store = loadWorkflowLayoutStore()
  const next: WorkflowLayoutStore = []
  for (const obj of store) {
    if (!Object.prototype.hasOwnProperty.call(obj, workflowId)) {
      next.push(obj)
      continue
    }
    const { [workflowId]: _removed, ...rest } = obj
    if (Object.keys(rest).length) next.push(rest)
  }
  saveWorkflowLayoutStore(next)
}

export function deleteWorkflowLayoutPreset(
  workflowId: string,
  presetKey: WorkflowLayoutPresetKey,
): WorkflowLayoutEntry | null {
  const prevStored = getWorkflowLayoutEntryStored(workflowId)
  if (!prevStored) return null
  const presets = { ...prevStored.presets } as NonNullable<WorkflowLayoutEntryStored["presets"]>
  delete presets[presetKey]

  const nextStored: WorkflowLayoutEntryStored = { ...prevStored }
  if (Object.keys(presets).length) nextStored.presets = presets
  else delete nextStored.presets

  // If we removed the selected preset, fall back to default (and omit selected in storage).
  const selectedComputed = prevStored.selected ?? DEFAULT_PRESET
  const selected = selectedComputed === presetKey ? DEFAULT_PRESET : selectedComputed
  if (selected === DEFAULT_PRESET) delete nextStored.selected
  else nextStored.selected = selected

  const hasPresets = !!nextStored.presets && Object.keys(nextStored.presets).length > 0
  if (!nextStored.selected && !hasPresets) {
    deleteWorkflowLayoutEntry(workflowId)
    return { selected, presets: {} }
  }

  upsertWorkflowLayoutEntryStored(workflowId, nextStored)
  return { selected, presets: nextStored.presets ?? {} }
}

export function setWorkflowLayoutSelected(workflowId: string, selected: WorkflowLayoutPresetKey): WorkflowLayoutEntry {
  const prevStored = getWorkflowLayoutEntryStored(workflowId) ?? {}
  const nextStored: WorkflowLayoutEntryStored = {
    ...prevStored,
  }
  if (selected === DEFAULT_PRESET) delete nextStored.selected
  else nextStored.selected = selected

  // If the entry would become empty, don't store it.
  const hasPresets = !!nextStored.presets && Object.keys(nextStored.presets).length > 0
  if (!nextStored.selected && !hasPresets) {
    deleteWorkflowLayoutEntry(workflowId)
    return { selected, presets: {} }
  }

  upsertWorkflowLayoutEntryStored(workflowId, nextStored)
  return { selected, presets: nextStored.presets ?? {} }
}

export function upsertWorkflowPreset(
  workflowId: string,
  presetKey: WorkflowLayoutPresetKey,
  positions: Record<string, WorkflowLayoutPoint>,
  opts?: { selected?: WorkflowLayoutPresetKey; layoutSig?: string },
): WorkflowLayoutEntry {
  const prevStored = getWorkflowLayoutEntryStored(workflowId) ?? {}
  const prevPresets = prevStored.presets ?? {}
  const presets: NonNullable<WorkflowLayoutEntryStored["presets"]> = {
    ...prevPresets,
    [presetKey]: { positions, updatedAt: new Date().toISOString(), layoutSig: opts?.layoutSig },
  }
  const selected = opts?.selected ?? prevStored.selected ?? DEFAULT_PRESET

  const nextStored: WorkflowLayoutEntryStored = { presets }
  if (selected !== DEFAULT_PRESET) nextStored.selected = selected

  upsertWorkflowLayoutEntryStored(workflowId, nextStored)
  return { selected, presets }
}

"use client"

import * as React from "react"

import { safeReadLocalStorageJson } from "@/hooks/list-page-utils"

/**
 * Apply a saved pageSize preference from localStorage once after list state is initialized.
 * This avoids duplicating "read localStorage + guard URL param + setState" logic across list pages.
 */
export function usePageSizePreferenceOnce<TAllowed extends number>(p: {
  didInit: boolean
  storageKey: string
  /** If this URL param is present, it takes precedence over localStorage. Usually "pageSize". */
  urlParam?: string
  normalize: (raw: unknown) => TAllowed
  getCurrent: () => TAllowed
  setNext: (next: TAllowed) => void
}) {
  const urlParam = p.urlParam ?? "pageSize"

  const normalizeRef = React.useRef(p.normalize)
  const getCurrentRef = React.useRef(p.getCurrent)
  const setNextRef = React.useRef(p.setNext)
  React.useEffect(() => {
    normalizeRef.current = p.normalize
    getCurrentRef.current = p.getCurrent
    setNextRef.current = p.setNext
  }, [p.getCurrent, p.normalize, p.setNext])

  React.useEffect(() => {
    if (!p.didInit) return
    if (typeof window === "undefined") return
    const urlHas = new URLSearchParams(window.location.search).has(urlParam)
    if (urlHas) return
    const stored = safeReadLocalStorageJson(p.storageKey)
    const next = normalizeRef.current(stored)
    if (next === getCurrentRef.current()) return
    setNextRef.current(next)
  }, [p.didInit, p.storageKey, urlParam])
}

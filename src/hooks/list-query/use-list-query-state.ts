"use client"

import * as React from "react"

import { buildPathWithQuery, updateUrlNoNav, type UrlUpdateKind } from "@/hooks/list-query/list-query-url"

export type ListQueryUrlMode = { strategy: "replaceState"; kind?: UrlUpdateKind } | { strategy: "disabled" }

export type ListQueryStateCodec<TState> = {
  /** Parse from current URL query params. */
  parse: (qp: URLSearchParams) => Partial<TState>
  /** Write owned keys into qp (mutate), and return qp. */
  serialize: (state: TState, qp: URLSearchParams) => URLSearchParams
}

export type UseListQueryStateOpts<TState> = {
  basePath: string
  defaults: TState
  codec: ListQueryStateCodec<TState>
  /**
   * Which keys should reset page index when changed.
   * (e.g. search/sort/status changes should go back to page 0.)
   */
  resetPageIndexDeps?: Array<(s: TState) => unknown>
  /** Called to apply page reset. If provided, it will run when deps change. */
  onResetPageIndex?: () => void
  /** URL mirroring behavior. Default: replaceState (no Next navigation). */
  urlMode?: ListQueryUrlMode
}

function mergeState<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  return { ...base, ...patch }
}

export function useListQueryState<TState extends Record<string, unknown>>(opts: UseListQueryStateOpts<TState>) {
  const { basePath, defaults, codec } = opts
  const urlMode: ListQueryUrlMode = opts.urlMode ?? { strategy: "replaceState", kind: "replace" }
  const urlKind: UrlUpdateKind = urlMode.strategy === "replaceState" ? (urlMode.kind ?? "replace") : "replace"

  const didInitRef = React.useRef(false)
  const applyingFromPopstateRef = React.useRef(false)

  const [state, setState] = React.useState<TState>(defaults)

  const readFromLocation = React.useCallback((): Partial<TState> => {
    if (typeof window === "undefined") return {}
    const qp = new URLSearchParams(window.location.search)
    return codec.parse(qp)
  }, [codec])

  React.useEffect(() => {
    if (didInitRef.current) return
    const patch = readFromLocation()
    setState((prev) => mergeState(prev, patch))
    didInitRef.current = true
  }, [readFromLocation])

  React.useEffect(() => {
    if (urlMode.strategy !== "replaceState") return
    const onPop = () => {
      applyingFromPopstateRef.current = true
      const patch = readFromLocation()
      setState((prev) => mergeState(mergeState(prev, defaults), patch))
      queueMicrotask(() => {
        applyingFromPopstateRef.current = false
      })
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [defaults, readFromLocation, urlMode.strategy])

  const resetDeps = opts.resetPageIndexDeps ?? []
  React.useEffect(
    () => {
      if (!didInitRef.current) return
      if (resetDeps.length === 0) return
      opts.onResetPageIndex?.()
    },
    resetDeps.map((fn) => fn(state)),
  )

  const lastMirroredUrlRef = React.useRef<string>("")

  React.useEffect(() => {
    if (!didInitRef.current) return
    if (urlMode.strategy === "disabled") return
    if (urlMode.strategy !== "replaceState") return
    if (applyingFromPopstateRef.current) return

    const qp = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search)
    const nextQp = codec.serialize(state, qp)
    const nextUrl = buildPathWithQuery(basePath, nextQp)

    if (lastMirroredUrlRef.current === nextUrl) return
    lastMirroredUrlRef.current = nextUrl

    updateUrlNoNav(nextUrl, urlKind)
  }, [basePath, codec, state, urlKind, urlMode.strategy])

  return {
    state,
    setState,
    didInit: didInitRef.current,
  }
}

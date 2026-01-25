"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export type ScrollContainerApi = {
  /** Returns the current scroll container element (if mounted). */
  getElement: () => HTMLElement | null
  /** Scroll the container to top. */
  scrollToTop: (opts?: { behavior?: ScrollBehavior }) => void
}

const ScrollContainerContext = React.createContext<ScrollContainerApi | null>(null)

export function ScrollContainerProvider({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null)

  const api = React.useMemo<ScrollContainerApi>(
    () => ({
      getElement: () => ref.current,
      scrollToTop: (opts) => {
        ref.current?.scrollTo({ top: 0, behavior: opts?.behavior ?? "auto" })
      },
    }),
    [],
  )

  return (
    <ScrollContainerContext.Provider value={api}>
      <div ref={ref} data-scroll-container className={cn(className)}>
        {children}
      </div>
    </ScrollContainerContext.Provider>
  )
}

export function useScrollContainer() {
  return React.useContext(ScrollContainerContext)
}

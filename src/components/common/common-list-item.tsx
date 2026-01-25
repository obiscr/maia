"use client"

import Link from "next/link"
import * as React from "react"

import { Item, ItemActions } from "@/components/ui/item"
import { cn } from "@/lib/utils"

type CommonListItemColumn = {
  key: string
  /** Full content (can be multi-line). */
  content: React.ReactNode
  /** Single-line summary when this column is pushed to a lower row. */
  collapsedContent?: React.ReactNode
  /** Minimum width used by the layout algorithm (in px). */
  minWidthPx?: number
  /** Higher values collapse earlier when space is tight (defaults to column index). */
  collapsePriority?: number
  /** If true, column stays visible on mobile. Defaults to: only the first column. */
  showOnMobile?: boolean
  /** Optional wrapper class for the column container. */
  className?: string
  /** Optional wrapper class for the collapsed row container. */
  collapsedClassName?: string
}

function useElementWidth<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null)
  const [width, setWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const w = entries?.[0]?.contentRect?.width
      if (typeof w === "number" && Number.isFinite(w)) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, width }
}

function useColumnWidths<T extends HTMLElement>(count: number) {
  const elsRef = React.useRef<Array<T | null>>([])
  const [widths, setWidths] = React.useState<number[]>([])

  React.useEffect(() => {
    elsRef.current = Array.from({ length: count }, (_, i) => elsRef.current[i] ?? null)
    setWidths((prev) => {
      if (prev.length === count) return prev
      return Array.from({ length: count }, (_, i) => prev[i] ?? 0)
    })
  }, [count])

  React.useLayoutEffect(() => {
    const els = elsRef.current
    if (!els.length) return

    const ro = new ResizeObserver((entries) => {
      setWidths((prev) => {
        let next = prev
        for (const e of entries) {
          const el = e.target as T
          const idx = els.indexOf(el)
          if (idx < 0) continue
          const w = e.contentRect?.width
          if (typeof w !== "number" || !Number.isFinite(w)) continue
          if (Math.abs((next[idx] ?? 0) - w) < 0.5) continue
          if (next === prev) next = [...prev]
          next[idx] = w
        }
        return next
      })
    })

    for (const el of els) {
      if (el) ro.observe(el)
    }
    return () => ro.disconnect()
  }, [count])

  const setRef = React.useCallback(
    (idx: number): React.RefCallback<T> =>
      (el) => {
        elsRef.current[idx] = el
      },
    [],
  )

  return { widths, setRef }
}

/**
 * Returns whether viewport is >= md.
 *
 * IMPORTANT: Starts as `null` so the first render doesn't "guess" and omit columns.
 * This avoids a noticeable flash where the middle column skeleton appears late.
 */
function useIsMdUp(): boolean | null {
  const [isMdUp, setIsMdUp] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const onChange = () => setIsMdUp(mq.matches)
    onChange()
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return isMdUp
}

export function CommonListItem(props: {
  href?: string
  size?: "default" | "sm"
  className?: string
  columns: CommonListItemColumn[]
  actions?: React.ReactNode
  actionsClassName?: string
  /** Horizontal gap between columns (desktop). */
  columnsGapClassName?: string
}) {
  const isMdUp = useIsMdUp()
  const { ref: containerRef, width: containerWidth } = useElementWidth<HTMLDivElement>()
  const { ref: actionsRef, width: actionsWidth } = useElementWidth<HTMLDivElement>()

  const cols = props.columns ?? []
  const hasActions = !!props.actions
  const { widths: colWidths, setRef: setColRef } = useColumnWidths<HTMLDivElement>(cols.length)

  const layout = React.useMemo(() => {
    const n = cols.length
    if (n === 0) return { primary: [], overflow: [] as number[] }

    // Mobile: keep only explicitly allowed columns (default: first column only).
    // Note: When `isMdUp` is `null` (first render), we fall through to the desktop path
    // so we don't omit columns before we know the viewport size.
    if (isMdUp === false) {
      const primary = cols
        .map((c, idx) => ({ c, idx }))
        .filter(({ idx, c }) => idx === 0 || c.showOnMobile)
        .map(({ idx }) => idx)
      return { primary, overflow: [] as number[] }
    }

    // Desktop: collapse from right to left (excluding the first column).
    const candidateIdxs = Array.from({ length: n }, (_, i) => i).filter((i) => i !== 0)
    const priorities = candidateIdxs
      .map((i) => ({
        idx: i,
        pr: typeof cols[i]?.collapsePriority === "number" ? (cols[i]!.collapsePriority as number) : i,
      }))
      .sort((a, b) => b.pr - a.pr)

    // If we can't measure yet, render everything (no collapse).
    const safeContainerWidth = typeof containerWidth === "number" && containerWidth > 0 ? containerWidth : null
    const safeActionsWidth = hasActions && typeof actionsWidth === "number" && actionsWidth > 0 ? actionsWidth : 0

    if (!safeContainerWidth) {
      return { primary: [0, ...candidateIdxs], overflow: [] as number[] }
    }

    const gapPx = 16 // matches md:gap-x-4 (1rem)
    const available = Math.max(0, safeContainerWidth - safeActionsWidth - (hasActions ? gapPx : 0))

    const minWidth = (i: number) => {
      const v = cols[i]?.minWidthPx
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0
    }

    const included = new Set(candidateIdxs)
    const requiredWidth = (i: number) => {
      const measured = typeof colWidths?.[i] === "number" ? colWidths[i]! : 0
      return Math.max(minWidth(i), measured)
    }
    const sumRequired = () => Array.from(included).reduce((acc, i) => acc + requiredWidth(i), 0)
    const gapsRequired = () => (included.size > 0 ? gapPx * included.size : 0) // gap between first col and each fixed col

    // Keep first column always; ensure remaining fixed columns fit.
    while (included.size > 0 && sumRequired() + gapsRequired() > available) {
      const next = priorities.find((p) => included.has(p.idx))
      if (!next) break
      included.delete(next.idx)
    }

    const primary = [0, ...Array.from(included).sort((a, b) => a - b)]
    const overflow = candidateIdxs.filter((i) => !included.has(i)).sort((a, b) => a - b)
    return { primary, overflow }
  }, [actionsWidth, colWidths, cols, containerWidth, hasActions, isMdUp])

  const primaryCols = layout.primary.map((i) => ({ idx: i, col: cols[i] })).filter((x) => !!x.col)
  const overflowCols = layout.overflow.map((i) => ({ idx: i, col: cols[i] })).filter((x) => !!x.col)

  const content = (
    <div ref={containerRef} className="min-w-0 flex-1">
      <div className={cn("flex w-full min-w-0 items-start md:gap-x-4", props.columnsGapClassName)}>
        {primaryCols.map(({ idx, col }) => {
          const isFirst = idx === 0
          const minWidthPx = typeof col.minWidthPx === "number" ? col.minWidthPx : undefined
          return (
            <div
              key={col.key}
              className={cn("min-w-0", isFirst ? "flex-1" : "hidden shrink-0 md:block", col.className)}
              style={!isFirst && minWidthPx ? { width: minWidthPx, minWidth: minWidthPx } : undefined}
              ref={idx === 0 ? undefined : setColRef(idx)}
            >
              {col.content}
            </div>
          )
        })}
      </div>

      {isMdUp === false
        ? null
        : overflowCols.map(({ idx, col }) => (
            <div
              key={`overflow:${col.key}`}
              className={cn(
                "mt-1 min-w-0 text-xs text-muted-foreground",
                // force single-line (even if caller passes multi-line nodes)
                "overflow-hidden text-ellipsis whitespace-nowrap",
                col.collapsedClassName,
              )}
            >
              {col.collapsedContent ?? col.content}
            </div>
          ))}
    </div>
  )

  return (
    <Item
      size={props.size ?? "sm"}
      className={cn("rounded-none border-0 px-4 py-3 hover:bg-muted/30", props.className)}
    >
      <div className="flex w-full min-w-0 items-start gap-4">
        {/* Keep non-action columns clickable, but avoid nesting <button> inside <a>. */}
        {props.href ? (
          <Link href={props.href} className="min-w-0 flex-1">
            {content}
          </Link>
        ) : (
          content
        )}

        {hasActions ? (
          <ItemActions ref={actionsRef} className={cn("shrink-0 items-start", props.actionsClassName)}>
            {props.actions}
          </ItemActions>
        ) : null}
      </div>
    </Item>
  )
}

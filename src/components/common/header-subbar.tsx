"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type Breakpoint = "sm" | "md" | "lg"

function hideAt(bp: Breakpoint) {
  // Keep Tailwind classes static for JIT.
  const map = {
    sm: "sm:hidden",
    md: "md:hidden",
    lg: "lg:hidden",
  } as const
  return map[bp]
}

/**
 * Header "subbar" (a secondary row under the title area).
 *
 * This intentionally uses a Radix/HeadlessUI-style slot API:
 * - <HeaderSubbar>
 *     <HeaderSubbar.Left>...</HeaderSubbar.Left>
 *     <HeaderSubbar.Right>...</HeaderSubbar.Right>
 *   </HeaderSubbar>
 *
 * Why:
 * - The bar owns layout + responsive rules.
 * - Callers own business complexity (the nodes placed into slots can be large).
 */
export function HeaderSubbar(props: {
  children?: React.ReactNode
  className?: string
  /** Hide this row at/above the breakpoint (default: "lg" => show on <lg only). */
  hideAt?: Breakpoint
}) {
  if (!props.children) return null
  return (
    <div
      className={cn(
        hideAt(props.hideAt ?? "lg"),
        "flex flex-col gap-3 md:flex-row md:items-center md:justify-between",
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

export namespace HeaderSubbar {
  export function Left(props: { className?: string; children: React.ReactNode }) {
    return <div className={cn("flex min-w-0 flex-wrap items-center gap-2", props.className)}>{props.children}</div>
  }

  export function Right(props: { className?: string; children: React.ReactNode }) {
    return (
      <div className={cn("flex shrink-0 flex-wrap items-center gap-2 md:ml-auto", props.className)}>
        {props.children}
      </div>
    )
  }
}

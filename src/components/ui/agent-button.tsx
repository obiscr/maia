"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

const AGENT_BUTTON_CLASSNAME =
  "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-500 text-white hover:opacity-95"

export type AgentButtonProps = Omit<React.ComponentProps<typeof Button>, "variant"> & {
  /**
   * `AgentButton` defaults to `secondary` variant (to match existing UI),
   * while applying the gradient style via `className`.
   */
  variant?: React.ComponentProps<typeof Button>["variant"]

  /**
   * Only used when `asChild` is false.
   * When `asChild` is true, the child must be a single element (e.g. <Link/>),
   * so the caller should place icons inside that child.
   */
  icon?: React.ReactNode
  loading?: boolean
}

export function AgentButton({
  className,
  variant = "secondary",
  icon,
  loading,
  disabled,
  asChild,
  children,
  ...props
}: AgentButtonProps) {
  const isDisabled = disabled || !!loading

  return (
    <Button
      {...props}
      asChild={asChild}
      variant={variant}
      disabled={isDisabled}
      className={cn(AGENT_BUTTON_CLASSNAME, className)}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner className="h-4 w-4" /> : icon}
          {children}
        </>
      )}
    </Button>
  )
}



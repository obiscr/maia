"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { Item, ItemDescription, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"

/**
 * ItemCard
 * - Card-like container built on top of shadcn/ui `Item`.
 * - Use this when you want GitHub-style "pinned" cards but still keep the Item system as the base.
 */
export function ItemCard(
  props: React.ComponentProps<"div"> & {
    asChild?: boolean
  },
) {
  const { className, asChild = false, ...rest } = props
  const Comp = asChild ? Slot : "div"

  return (
    <Item
      asChild
      variant="outline"
      size="default"
      className={cn(
        // Base: behave like a card (not a row)
        "flex-col items-stretch",
        "p-0 gap-0",
        // Visuals: GitHub-ish
        "text-card-foreground",
        "transition-colors hover:bg-muted/30",
        className,
      )}
    >
      <Comp {...rest} />
    </Item>
  )
}

export function ItemCardHeader(props: React.ComponentProps<"div">) {
  const { className, ...rest } = props
  return <div data-slot="item-card-header" className={cn("flex flex-col", className)} {...rest} />
}

export function ItemCardContent(props: React.ComponentProps<"div">) {
  const { className, ...rest } = props
  return <div data-slot="item-card-content" className={cn("flex flex-col", className)} {...rest} />
}

export function ItemCardFooter(props: React.ComponentProps<"div">) {
  const { className, ...rest } = props
  return <div data-slot="item-card-footer" className={cn("flex items-center", className)} {...rest} />
}

export function ItemCardActions(props: React.ComponentProps<"div">) {
  const { className, ...rest } = props
  return <div data-slot="item-card-actions" className={cn("flex items-center gap-2", className)} {...rest} />
}

export function ItemCardTitle(props: React.ComponentProps<typeof ItemTitle>) {
  const { className, ...rest } = props
  return <ItemTitle className={cn("min-w-0 w-full", className)} {...rest} />
}

export function ItemCardDescription(props: React.ComponentProps<typeof ItemDescription>) {
  const { className, ...rest } = props
  return <ItemDescription className={cn("min-w-0 w-full", className)} {...rest} />
}

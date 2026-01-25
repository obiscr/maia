"use client"

import * as React from "react"

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "lucide-react"

export type NavMenuFilterOption = {
  value: string
  label: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
}

type TriggerMode = "hover" | "click"
type TriggerVariant = "plain" | "solid"

const NavMenuFiltersCtx = React.createContext<{
  triggerMode: TriggerMode
  contentAlign: "start" | "end"
  triggerVariant: TriggerVariant
  openValue: string
  setOpenValue: (v: string) => void
} | null>(null)

export function NavMenuFilters(props: {
  value: string
  onValueChange: (v: string) => void
  children: React.ReactNode
  className?: string
  listClassName?: string
  triggerMode?: TriggerMode
  contentAlign?: "start" | "end"
  triggerVariant?: TriggerVariant
}) {
  const ctx = React.useMemo(
    () => ({
      triggerMode: props.triggerMode ?? "click",
      contentAlign: props.contentAlign ?? "end",
      triggerVariant: props.triggerVariant ?? "plain",
      openValue: props.value,
      setOpenValue: props.onValueChange,
    }),
    [props.contentAlign, props.onValueChange, props.triggerMode, props.triggerVariant, props.value],
  )
  const justify = (props.contentAlign ?? "end") === "start" ? "justify-start" : "justify-end"
  return (
    <NavMenuFiltersCtx.Provider value={ctx}>
      <div className={cn("flex", justify, props.className)}>
        <div className={cn("flex flex-wrap gap-2", justify, props.listClassName)}>{props.children}</div>
      </div>
    </NavMenuFiltersCtx.Provider>
  )
}

export function NavMenuFilter<V extends string>(props: {
  menuValue: string
  label: React.ReactNode
  valueLabel?: React.ReactNode
  showValueInTrigger?: boolean
  options: ReadonlyArray<NavMenuFilterOption & { value: V }>
  selectedValue: V
  onSelectValue: (v: V) => void
  closeMenu: () => void
  disabled?: boolean
  triggerClassName?: string
  contentClassName?: string
}) {
  const ctx = React.useContext(NavMenuFiltersCtx)
  const triggerMode = ctx?.triggerMode ?? "click"
  const contentAlign = ctx?.contentAlign ?? "end"
  const triggerVariant = ctx?.triggerVariant ?? "plain"
  const current = props.options.find((o) => o.value === props.selectedValue)
  const showValue = props.showValueInTrigger !== false

  const triggerText = (
    <span className="inline-flex items-center gap-2">
      <span className={cn(showValue ? "text-muted-foreground" : "text-foreground")}>{props.label}</span>
      {showValue ? (
        <span className="font-medium text-foreground">{props.valueLabel ?? current?.label ?? "—"}</span>
      ) : null}
    </span>
  )

  const openValue = ctx?.openValue ?? ""
  const setOpenValue = ctx?.setOpenValue ?? (() => {})
  const open = openValue === props.menuValue

  const close = () => {
    props.closeMenu()
    // In case caller doesn't clear the value, ensure it's closed.
    setOpenValue("")
  }

  const isHover = triggerMode === "hover"

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (props.disabled) return
        setOpenValue(next ? props.menuValue : "")
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-md",
            "h-8 px-3 text-sm font-medium",
            triggerVariant === "plain"
              ? "bg-transparent hover:bg-accent/40 data-[state=open]:bg-accent/40"
              : "border border-input bg-background hover:bg-muted/60 data-[state=open]:bg-muted/60",
            props.disabled ? "pointer-events-none opacity-60" : "",
            props.triggerClassName,
          )}
          disabled={props.disabled}
          onPointerEnter={
            isHover
              ? () => {
                  if (props.disabled) return
                  setOpenValue(props.menuValue)
                }
              : undefined
          }
          onPointerLeave={
            isHover
              ? () => {
                  if (props.disabled) return
                  setOpenValue("")
                }
              : undefined
          }
        >
          {triggerText}
          <ChevronDownIcon className="relative top-[1px] size-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align={contentAlign === "end" ? "end" : "start"}
        sideOffset={6}
        // Critical: allow Radix/Popper to keep the menu within the viewport on mobile.
        collisionPadding={8}
        className={cn("z-50 p-1", "w-max max-w-[calc(100vw-16px)]", props.contentClassName)}
      >
        <div className="grid gap-1">
          {props.options.map((o) => {
            const active = o.value === props.selectedValue
            return (
              <DropdownMenuItem
                key={o.value}
                disabled={o.disabled}
                className={cn("flex items-center gap-2", active ? "bg-accent/60" : "")}
                onSelect={(e) => {
                  e.preventDefault()
                  if (o.disabled) return
                  props.onSelectValue(o.value)
                  close()
                }}
              >
                {o.icon ? <span className="shrink-0 [&_svg]:size-4">{o.icon}</span> : null}
                <span>{o.label}</span>
              </DropdownMenuItem>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

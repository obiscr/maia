"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type LocaleComboboxItem<T extends string = string> = {
  value: T
  label: string
  searchText?: string
}

export function LocaleCombobox<T extends string>(props: {
  items: Array<LocaleComboboxItem<T>>
  value: T
  onValueChange: (value: T) => void
  disabled?: boolean
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  className?: string
  menuClassName?: string
}) {
  const { items, value, onValueChange, disabled, placeholder, searchPlaceholder, emptyText, className, menuClassName } =
    props

  const [open, setOpen] = React.useState(false)
  const isMobile = useIsMobile()

  const selected = React.useMemo(() => items.find((it) => it.value === value) ?? null, [items, value])

  function select(next: T) {
    onValueChange(next)
    setOpen(false)
  }

  const Trigger = React.useMemo(() => {
    return React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
      ({ className: triggerClassName, disabled: triggerDisabled, ...triggerProps }, ref) => (
        <Button
          ref={ref}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("min-w-0 justify-between overflow-hidden", className, triggerClassName)}
          disabled={disabled || triggerDisabled}
          {...triggerProps}
        >
          <span className="min-w-0 truncate" title={selected ? selected.label : placeholder}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="shrink-0 opacity-50" />
        </Button>
      ),
    )
  }, [className, disabled, open, placeholder, selected?.label])

  function Menu() {
    return (
      <Command className={cn("w-full max-w-full", menuClassName)}>
        <CommandInput placeholder={searchPlaceholder} className="h-9" />
        <CommandList
          className="max-h-[min(300px,var(--radix-popper-available-height,300px))] overscroll-contain"
          onWheelCapture={(e) => e.stopPropagation()}
          onTouchMoveCapture={(e) => e.stopPropagation()}
        >
          <CommandEmpty>{emptyText}</CommandEmpty>
          <CommandGroup>
            {items.map((it) => {
              const isSelected = value === it.value
              return (
                <CommandItem
                  key={it.value}
                  value={`${it.label} ${it.searchText ?? ""}`.trim()}
                  onSelect={() => select(it.value)}
                  className="w-full overflow-hidden"
                >
                  <span className="flex-1 min-w-0 truncate" title={it.label}>
                    {it.label}
                  </span>
                  <Check className={cn("ml-auto", isSelected ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    )
  }

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Trigger />
        </DrawerTrigger>
        <DrawerContent>
          <DrawerTitle className="sr-only">{placeholder}</DrawerTitle>
          <div className="mt-4 border-t p-0">
            <Menu />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        // Use available width to avoid clipping the 1px border when near edges / fractional px widths.
        className="w-[min(var(--radix-popper-anchor-width),var(--radix-popper-available-width))] p-0"
      >
        <Menu />
      </PopoverContent>
    </Popover>
  )
}

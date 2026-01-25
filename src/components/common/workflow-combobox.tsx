"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type WorkflowComboboxItem = {
  id: string
  name: string
}

export function WorkflowCombobox(props: {
  items: WorkflowComboboxItem[]
  value: string
  onValueChange: (workflowId: string) => void
  disabled?: boolean
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  className?: string
}) {
  const { items, value, onValueChange, disabled, placeholder, searchPlaceholder, emptyText, className } = props
  const [open, setOpen] = React.useState(false)
  const isMobile = useIsMobile()

  const selected = React.useMemo(() => items.find((w) => w.id === value) ?? null, [items, value])

  function select(nextId: string) {
    onValueChange(nextId === value ? "" : nextId)
    setOpen(false)
  }

  const WorkflowSelectorTrigger = React.useMemo(() => {
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
          <span className="min-w-0 truncate" title={selected ? selected.name : placeholder}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="shrink-0 opacity-50" />
        </Button>
      ),
    )
  }, [className, disabled, open, placeholder, selected?.name])

  function WorkflowSelectorMenu() {
    return (
      <Command className="w-full max-w-full">
        <CommandInput placeholder={searchPlaceholder} className="h-9" />
        <CommandList
          className="max-h-[min(300px,var(--radix-popper-available-height,300px))] overscroll-contain"
          onWheelCapture={(e) => e.stopPropagation()}
          onTouchMoveCapture={(e) => e.stopPropagation()}
        >
          <CommandEmpty>{emptyText}</CommandEmpty>
          <CommandGroup>
            {items.map((w) => {
              const isSelected = value === w.id
              return (
                <CommandItem
                  key={w.id}
                  value={`${w.name} ${w.id}`}
                  onSelect={() => select(w.id)}
                  className="w-full overflow-hidden"
                >
                  <span className="flex-1 min-w-0 truncate" title={w.name}>
                    {w.name}
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
          <WorkflowSelectorTrigger />
        </DrawerTrigger>
        <DrawerContent>
          <DrawerTitle className="sr-only">{placeholder}</DrawerTitle>
          <div className="mt-4 border-t p-0">
            <WorkflowSelectorMenu />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <WorkflowSelectorTrigger />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-[min(var(--radix-popper-anchor-width),var(--radix-popper-available-width))] p-0"
      >
        <WorkflowSelectorMenu />
      </PopoverContent>
    </Popover>
  )
}

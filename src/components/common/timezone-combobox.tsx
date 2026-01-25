"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const FALLBACK_TIMEZONES = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Australia/Sydney",
] as const

function uniqueStrings(xs: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const v = String(x || "").trim()
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function getAllTimezones(): string[] {
  try {
    const fn = (Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf
    if (typeof fn === "function") {
      const values = fn.call(Intl, "timeZone")
      if (Array.isArray(values) && values.length) return uniqueStrings(values)
    }
  } catch {
    // ignore
  }
  return uniqueStrings([...FALLBACK_TIMEZONES])
}

function getLocalTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export function TimezoneCombobox(props: {
  value: string
  onValueChange: (timezone: string) => void
  disabled?: boolean
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  commonGroupLabel: string
  allGroupLabel: string
  className?: string
  menuClassName?: string
}) {
  const {
    value,
    onValueChange,
    disabled,
    placeholder,
    searchPlaceholder,
    emptyText,
    commonGroupLabel,
    allGroupLabel,
    className,
    menuClassName,
  } = props

  const [open, setOpen] = React.useState(false)
  const isMobile = useIsMobile()

  const [allTimezones, setAllTimezones] = React.useState<string[]>(() => uniqueStrings([...FALLBACK_TIMEZONES]))
  const [allLoaded, setAllLoaded] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const RENDER_LIMIT = 120
  const localTz = React.useMemo(() => getLocalTimezone(), [])

  React.useEffect(() => {
    if (!open) return
    setQuery("")
    if (allLoaded) return
    const tmr = window.setTimeout(() => {
      // Load full list in the background (after initial UI paint).
      const tzs = getAllTimezones()
      setAllTimezones(tzs)
      setAllLoaded(true)
    }, 0)
    return () => window.clearTimeout(tmr)
  }, [allLoaded, open])

  const commonTimezones = React.useMemo(() => {
    const commons = uniqueStrings([
      "UTC",
      localTz ?? "",
      ...FALLBACK_TIMEZONES,
      // ensure a couple of global defaults
      "Europe/London",
      "America/New_York",
    ])
    // keep only ones that exist in the all list (when we have full IANA list)
    const allSet = new Set(allTimezones)
    return commons.filter((tz) => allSet.has(tz) || allTimezones.length === FALLBACK_TIMEZONES.length)
  }, [allTimezones, localTz])

  const selectedLabel = React.useMemo(() => {
    const v = (value || "").trim()
    return v || ""
  }, [value])

  function select(nextTz: string) {
    onValueChange(nextTz)
    setOpen(false)
  }

  const filteredAllTimezones = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const out: string[] = []
    for (const tz of allTimezones) {
      if (tz.toLowerCase().includes(q)) {
        out.push(tz)
        if (out.length >= 200) break
      }
    }
    return out
  }, [allTimezones, query])

  const limitedAllTimezones = React.useMemo(() => {
    // Ensure selected value is visible even when we cap the list.
    const cap = allTimezones.slice(0, RENDER_LIMIT)
    const sel = selectedLabel
    if (!sel) return cap
    if (cap.includes(sel)) return cap
    if (allTimezones.includes(sel)) return [sel, ...cap]
    return cap
  }, [allTimezones, selectedLabel])

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
          <span className="min-w-0 truncate" title={selectedLabel || placeholder}>
            {selectedLabel || placeholder}
          </span>
          <ChevronsUpDown className="shrink-0 opacity-50" />
        </Button>
      ),
    )
  }, [className, disabled, open, placeholder, selectedLabel])

  function Menu() {
    const showSearchResults = !!query.trim()
    const listForAllGroup = showSearchResults ? (filteredAllTimezones ?? []) : limitedAllTimezones
    return (
      <Command className={cn("w-full max-w-full", menuClassName)} shouldFilter={false}>
        <CommandInput
          placeholder={searchPlaceholder}
          className="h-9"
          value={query}
          onValueChange={(v) => setQuery(v)}
        />
        <CommandList
          className="max-h-[min(320px,var(--radix-popper-available-height,320px))] overscroll-contain"
          onWheelCapture={(e) => e.stopPropagation()}
          onTouchMoveCapture={(e) => e.stopPropagation()}
        >
          {showSearchResults && listForAllGroup.length === 0 ? <CommandEmpty>{emptyText}</CommandEmpty> : null}

          {!showSearchResults ? (
            <CommandGroup heading={commonGroupLabel}>
              {commonTimezones.map((tz) => {
                const isSelected = value === tz
                return (
                  <CommandItem
                    key={`c:${tz}`}
                    value={tz}
                    onSelect={() => select(tz)}
                    className="w-full overflow-hidden"
                  >
                    <span className="flex-1 min-w-0 truncate" title={tz}>
                      {tz}
                    </span>
                    <Check className={cn("ml-auto", isSelected ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ) : null}

          <CommandGroup heading={allGroupLabel}>
            {listForAllGroup.map((tz) => {
              const isSelected = value === tz
              return (
                <CommandItem key={tz} value={tz} onSelect={() => select(tz)} className="w-full overflow-hidden">
                  <span className="flex-1 min-w-0 truncate" title={tz}>
                    {tz}
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
        className="w-[min(var(--radix-popper-anchor-width),var(--radix-popper-available-width))] p-0"
      >
        <Menu />
      </PopoverContent>
    </Popover>
  )
}

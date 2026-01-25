"use client"

import * as React from "react"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"

import { AgentButton } from "@/components/ui/agent-button"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type ButtonVariant = NonNullable<React.ComponentProps<typeof Button>["variant"]>
type ButtonSize = NonNullable<React.ComponentProps<typeof Button>["size"]>

export type HeaderAction = {
  key: string
  label: React.ReactNode
  icon?: React.ReactNode

  /** Either provide href (link) or onClick (button). */
  href?: string
  onClick?: () => void
  /** If true and `href` is provided, open the link in a new tab. */
  newTab?: boolean

  /** Render using the shared `AgentButton` style. */
  agent?: boolean

  /** Never move into overflow menu. */
  pinned?: boolean
  /** Whether this action may be collapsed into overflow. Defaults to true. */
  collapsible?: boolean
  /** Always render in overflow menu (never as a button). */
  overflowOnly?: boolean

  disabled?: boolean
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string

  /** Optional styling for the overflow menu item. */
  menuVariant?: "default" | "destructive"
}

export type HeaderActionSection = {
  key: string
  title?: React.ReactNode
  items: HeaderAction[]
}

type Breakpoint = "sm" | "md" | "lg"

function bpPair(bp: Breakpoint) {
  // IMPORTANT: keep Tailwind classes static (no template strings) so JIT can generate them.
  const map = {
    sm: { mobile: "sm:hidden", desktop: "hidden sm:inline-flex" },
    md: { mobile: "md:hidden", desktop: "hidden md:inline-flex" },
    lg: { mobile: "lg:hidden", desktop: "hidden lg:inline-flex" },
  } as const
  return map[bp]
}

export function HeaderActions(props: {
  /** Semantic grouping for overflow menu (auto separators + optional labels). */
  sections: HeaderActionSection[]
  className?: string
  /**
   * If set, actions with icons will render as icon-buttons below this breakpoint.
   * Defaults to "md" (<md shows icon-only).
   */
  iconOnlyBelow?: Breakpoint | false
  /**
   * When enabled, overflowed (collapsible) actions are moved into a dropdown menu.
   * Defaults to true.
   */
  overflow?: boolean
  overflowLabel?: string
  overflowAlign?: "start" | "end"
}) {
  const {
    sections,
    className,
    iconOnlyBelow = "md",
    overflow = true,
    overflowLabel = "More",
    overflowAlign = "end",
  } = props

  const actions = React.useMemo<HeaderAction[]>(() => sections.flatMap((s) => s.items), [sections])

  const pinned = React.useMemo(() => actions.filter((a) => !!a.pinned && !a.overflowOnly), [actions])
  const fixed = React.useMemo(
    () => actions.filter((a) => !a.pinned && a.collapsible === false && !a.overflowOnly),
    [actions],
  )
  const overflowOnly = React.useMemo(() => actions.filter((a) => !!a.overflowOnly), [actions])
  const collapsible = React.useMemo(
    () => actions.filter((a) => !a.pinned && a.collapsible !== false && !a.overflowOnly),
    [actions],
  )

  const [containerWidth, setContainerWidth] = React.useState(0)
  const [visibleCollapsibleCount, setVisibleCollapsibleCount] = React.useState(collapsible.length)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth)
    })
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  React.useLayoutEffect(() => {
    setVisibleCollapsibleCount(collapsible.length)
  }, [collapsible.length, pinned.length, containerWidth, iconOnlyBelow, overflow])

  React.useLayoutEffect(() => {
    if (!overflow) return
    const el = containerRef.current
    if (!el) return
    if (el.scrollWidth > el.clientWidth + 1 && visibleCollapsibleCount > 0) {
      setVisibleCollapsibleCount((c) => Math.max(0, c - 1))
    }
  }, [overflow, visibleCollapsibleCount, containerWidth])

  const visible = React.useMemo(() => {
    return [...pinned, ...fixed, ...collapsible.slice(0, visibleCollapsibleCount)]
  }, [pinned, fixed, collapsible, visibleCollapsibleCount])

  const hidden = React.useMemo(() => {
    return [...overflowOnly, ...collapsible.slice(visibleCollapsibleCount)]
  }, [overflowOnly, collapsible, visibleCollapsibleCount])

  const showOverflow = overflow && hidden.length > 0

  function renderButtonAction(a: HeaderAction) {
    const variant = a.variant ?? (a.agent ? "secondary" : "default")
    const size = a.size ?? "sm"

    const ButtonComp = a.agent ? AgentButton : Button

    const common = {
      variant,
      disabled: a.disabled,
      className: cn(a.className),
    } as const

    const hasIcon = !!a.icon
    const canIconOnly = !!iconOnlyBelow && hasIcon
    const bp = (iconOnlyBelow || "md") as Breakpoint
    const pair = bpPair(bp)

    const contentDesktop = (
      <>
        {a.icon}
        <span>{a.label}</span>
      </>
    )
    const contentIconOnly = (
      <>
        {a.icon}
        <span className="sr-only">{a.label}</span>
      </>
    )

    const desktopButton = a.href ? (
      <ButtonComp
        asChild
        size={size}
        {...common}
        className={cn(common.className, canIconOnly ? pair.desktop : undefined)}
      >
        <Link href={a.href} target={a.newTab ? "_blank" : undefined} rel={a.newTab ? "noreferrer" : undefined}>
          {contentDesktop}
        </Link>
      </ButtonComp>
    ) : (
      <ButtonComp
        size={size}
        {...common}
        className={cn(common.className, canIconOnly ? pair.desktop : undefined)}
        onClick={a.onClick}
        type="button"
      >
        {contentDesktop}
      </ButtonComp>
    )

    if (!canIconOnly) {
      return <React.Fragment key={a.key}>{desktopButton}</React.Fragment>
    }

    const iconBtnSize: ButtonSize = size.startsWith("icon") ? size : "icon-sm"
    const mobileButton = a.href ? (
      <ButtonComp asChild size={iconBtnSize} {...common} className={cn(common.className, pair.mobile)}>
        <Link href={a.href} target={a.newTab ? "_blank" : undefined} rel={a.newTab ? "noreferrer" : undefined}>
          {contentIconOnly}
        </Link>
      </ButtonComp>
    ) : (
      <ButtonComp
        size={iconBtnSize}
        {...common}
        className={cn(common.className, pair.mobile)}
        onClick={a.onClick}
        type="button"
      >
        {contentIconOnly}
      </ButtonComp>
    )

    return (
      <React.Fragment key={a.key}>
        {mobileButton}
        {desktopButton}
      </React.Fragment>
    )
  }

  function renderMenuItem(a: HeaderAction) {
    const content = (
      <>
        {a.icon}
        <span>{a.label}</span>
      </>
    )

    if (a.href) {
      return (
        <DropdownMenuItem key={a.key} asChild data-variant={a.menuVariant ?? "default"}>
          <Link
            href={a.href}
            target={a.newTab ? "_blank" : undefined}
            rel={a.newTab ? "noreferrer" : undefined}
            className="flex items-center gap-2"
          >
            {content}
          </Link>
        </DropdownMenuItem>
      )
    }

    return (
      <DropdownMenuItem
        key={a.key}
        data-variant={a.menuVariant ?? "default"}
        disabled={a.disabled}
        onSelect={() => a.onClick?.()}
      >
        {content}
      </DropdownMenuItem>
    )
  }

  function renderOverflowSections() {
    // Which collapsible items are currently hidden due to overflow?
    const hiddenCollapsibleKeys = new Set(collapsible.slice(visibleCollapsibleCount).map((a) => a.key))

    // For each section, render only items that are actually in the overflow menu:
    // - explicitly overflowOnly
    // - collapsible items that have been moved into overflow
    // - (explicit separators, if caller provided them in section items)
    const rendered: React.ReactNode[] = []
    let renderedAnySection = false

    for (const section of sections) {
      const sectionItems = section.items.filter((a) => {
        if (a.overflowOnly) return true
        return hiddenCollapsibleKeys.has(a.key)
      })

      if (!sectionItems.length) continue

      if (renderedAnySection) rendered.push(<DropdownMenuSeparator key={`sep-between-${section.key}`} />)
      renderedAnySection = true

      if (section.title) {
        rendered.push(
          <DropdownMenuLabel key={`label-${section.key}`} className="text-muted-foreground text-xs font-medium">
            {section.title}
          </DropdownMenuLabel>,
        )
      }

      for (const item of sectionItems) rendered.push(renderMenuItem(item))
    }

    return rendered
  }

  return (
    <div ref={containerRef} className={cn("flex min-w-0 max-w-full items-center gap-2 overflow-hidden", className)}>
      {visible.map((a) => renderButtonAction(a))}

      {showOverflow ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size={iconOnlyBelow ? "icon-sm" : "sm"} className="shrink-0" type="button">
              <MoreHorizontal aria-hidden="true" />
              <span className="sr-only">{overflowLabel}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={overflowAlign} sideOffset={6}>
            {renderOverflowSections()}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

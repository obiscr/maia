"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentType } from "react"
import { Bot, Clock, Mail, Settings } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

type NavItem = {
  href: string
  label: string
  Icon?: ComponentType<{ className?: string }>
}

export function SettingsNav({ showSystem = false }: { showSystem?: boolean }) {
  const pathname = usePathname()
  const { t } = useI18n()

  function isActive(href: string) {
    if (!pathname) return false
    if (href === "/preference") return pathname === "/preference"
    return pathname === href || pathname.startsWith(href + "/")
  }

  const items: NavItem[] = [
    {
      href: "/preference",
      label: t("settings.overview"),
      Icon: Settings,
    },
    {
      href: "/preference/agent",
      label: t("settings.agent.title"),
      Icon: Bot,
    },
    {
      href: "/preference/timezone",
      label: t("settings.timezone.title"),
      Icon: Clock,
    },
  ]

  const systemOpen = Boolean(pathname?.startsWith("/preference/system"))
  const systemChildren: NavItem[] = [
    { href: "/preference/system/registration", label: t("settings.system.registration.sectionTitle") },
    { href: "/preference/system/email", label: t("settings.system.email.sectionTitle") },
    { href: "/preference/system/performance", label: t("settings.system.performance.sectionTitle") },
    { href: "/preference/system/retention", label: t("settings.system.retention.sectionTitle") },
    { href: "/preference/system/security", label: t("settings.system.security.sectionTitle") },
  ]
  const systemChildActive = systemChildren.some((it) => isActive(it.href))

  return (
    <nav>
      {items.map((it) => {
        const active = isActive(it.href)
        return (
          <div key={it.href} className="relative">
            <Link
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                // Leave a gutter for the left indicator bar (GitHub-style).
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground",
                "hover:bg-muted/60 hover:text-foreground",
                active && "bg-muted text-foreground",
              )}
            >
              {it.Icon ? (
                <it.Icon className={cn("size-4", active ? "text-foreground" : "text-muted-foreground")} />
              ) : null}
              <span className={cn(active && "font-medium")}>{it.label}</span>
            </Link>
          </div>
        )
      })}

      {showSystem ? (
        <Accordion type="single" collapsible defaultValue={systemOpen ? "system" : undefined} className="rounded-md">
          <AccordionItem value="system" className="border-0">
            <AccordionTrigger
              className={cn(
                // NOTE: AccordionTrigger has a default `font-medium`. Override to keep
                // the trigger visually "normal" like typical sidebar groups.
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-muted-foreground no-underline",
                "hover:bg-muted/60 hover:text-foreground hover:no-underline",
                // Do not give the trigger an active background when a child is selected.
                // Only make the trigger text slightly darker when expanded (no bold).
                "data-[state=open]:text-foreground",
                // When any child item is selected, the group label should be emphasized.
                systemChildActive && "font-medium text-foreground",
                "[&>svg]:translate-y-0 [&>svg]:size-4 [&>svg]:text-muted-foreground [&>svg]:shrink-0",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Mail className={cn("size-4", systemChildActive ? "text-foreground" : "text-muted-foreground")} />
                <span>{t("sidebar.systemSettings")}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <div className="pl-6">
                {systemChildren.map((it) => {
                  const active = isActive(it.href)
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground",
                        "hover:bg-muted/60 hover:text-foreground",
                        active && "bg-muted text-foreground",
                      )}
                    >
                      <span className={cn(active && "font-medium")}>{it.label}</span>
                    </Link>
                  )
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </nav>
  )
}

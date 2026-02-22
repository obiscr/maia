"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { WorkflowIcon, PlayIcon, Clock, Layers, ListChecks, Activity } from "lucide-react"

import { MaiaLogo } from "@/components/maia-logo"
import { GradientBotIcon } from "@/components/icons/GradientBotIcon"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useI18n } from "@/components/i18n-provider"
import { SidebarUserMenu } from "@/components/sidebar-user-menu"

function NavItem(props: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  badge?: string
}) {
  const pathname = usePathname()
  const active = pathname === props.href || pathname.startsWith(`${props.href}/`)
  const Icon = props.icon

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={props.label} className={props.badge ? "pr-12" : undefined}>
        <Link href={props.href}>
          <Icon className="size-4" />
          <span>{props.label}</span>
        </Link>
      </SidebarMenuButton>
      {props.badge ? (
        <SidebarMenuBadge className="px-1.5 min-w-0 text-xs bg-primary/15 text-primary border border-primary">
          {props.badge}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const { t } = useI18n()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={t("app.name")}>
              <Link href="/">
                <div className="flex size-8 shrink-0 items-center justify-center">
                  <MaiaLogo className="size-8" title={t("app.name")} />
                </div>
                <div className="grid flex-1 min-w-0 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{t("app.name")}</span>
                  <span className="truncate text-xs text-muted-foreground">{t("app.subtitle")}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">
            {t("sidebar.agents")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem href="/agent" icon={GradientBotIcon} label={t("nav.agent")} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">
            {t("sidebar.workspace")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem href="/workflows" icon={WorkflowIcon} label={t("nav.workflows")} />
              <NavItem href="/runs" icon={PlayIcon} label={t("nav.runs")} />
              <NavItem href="/jobs" icon={ListChecks} label={t("nav.jobs")} />
              <NavItem href="/schedules" icon={Clock} label={t("nav.schedules")} />
              <NavItem href="/batches" icon={Layers} label={t("nav.batches")} />
              <NavItem href="/operations" icon={Activity} label={t("nav.operations")} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserMenu />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

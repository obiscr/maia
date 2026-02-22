"use client"

import * as React from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { ChevronsUpDown, Languages, Laptop, LogOut, Moon, Settings, Shield, Sun, User as UserIcon } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import type { Locale } from "@/lib/shared/i18n/constants"
import { apiFetchJson } from "@/lib/shared/http/api"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"

function initialsFromUser(params: { name?: string | null; email?: string | null }) {
  const name = (params.name ?? "").trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    const a = parts[0]?.[0] ?? ""
    const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
    const s = (a + b).toUpperCase()
    return s || "U"
  }
  const email = (params.email ?? "").trim()
  if (email) return email.slice(0, 1).toUpperCase()
  return "U"
}

export type NavUserData = {
  name: string
  email: string
  avatar: string
  role?: string
}

export function NavUser({ user }: { user: NavUserData }) {
  const { isMobile } = useSidebar()
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()
  const isAdmin = String(user.role ?? "") === "ADMIN"

  async function logout() {
    await apiFetchJson("/api/auth/logout", { method: "POST" }).catch(() => {})
    try {
      window.location.assign("/auth/redirect")
    } catch {}
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-md">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-md">{initialsFromUser(user)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 min-w-0 text-left text-sm leading-tight group-data-[collapsible=icon]/sidebar-wrapper:hidden">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]/sidebar-wrapper:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className={isMobile ? "rounded-md" : "w-[var(--radix-popper-anchor-width)] rounded-md"}
            side="top"
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-md">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-md">{initialsFromUser(user)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 min-w-0 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <Link href="/preference">
                <Settings className="size-4" />
                {t("sidebar.preferences")}
              </Link>
            </DropdownMenuItem>

            {isAdmin ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Shield className="size-4" />
                    {t("sidebar.admin")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/users">
                        <UserIcon className="size-4" />
                        {t("nav.adminUsers")}
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            ) : null}

            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="inline-flex size-4 items-center justify-center">
                  <Sun className="size-4 dark:hidden" />
                  <Moon className="hidden size-4 dark:block" />
                </span>
                {t("sidebar.theme")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={(theme ?? "system") as string} onValueChange={(v) => setTheme(v)}>
                  <DropdownMenuRadioItem value="light">
                    <Sun className="mr-2 size-4" />
                    {t("theme.light")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon className="mr-2 size-4" />
                    {t("theme.dark")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <Laptop className="mr-2 size-4" />
                    {t("theme.system")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Languages className="size-4" />
                {t("sidebar.language")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={locale} onValueChange={(v) => void setLocale(v as Locale)}>
                  <DropdownMenuRadioItem value="en">{t("language.english")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zh-cn">{t("language.chinese")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => void logout()}>
              <LogOut className="size-4" />
              {t("sidebar.logoutAction")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Languages, Laptop, Moon, Settings, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { useI18n } from "@/components/i18n-provider"
import type { Locale } from "@/lib/shared/i18n/constants"
import { apiFetchJson } from "@/lib/shared/http/api"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"

export function SidebarSettingsMenu() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const active = pathname === "/preference" || pathname.startsWith("/preference/")

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
            <SidebarMenuButton isActive={active} tooltip={t("sidebar.settings")}>
              <Settings className="size-4" />
              <span className="group-data-[collapsible=icon]/sidebar-wrapper:hidden">{t("sidebar.settings")}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-56">
            <DropdownMenuItem asChild>
              <Link href="/preference">
                <span className="inline-flex size-4 items-center justify-center">
                  <Settings className="size-4" />
                </span>
                {t("sidebar.preferences")}
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={() => void logout()}>
              <span className="inline-flex size-4 items-center justify-center">
                <Settings className="size-4" />
              </span>
              {t("sidebar.logoutAction")}
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="inline-flex size-4 items-center justify-center">
                  <Sun className="size-4 dark:hidden" />
                  <Moon className="hidden size-4 dark:block" />
                </span>
                {t("sidebar.theme")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2">{t("sidebar.theme")}</DropdownMenuLabel>
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
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2">{t("sidebar.language")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={locale} onValueChange={(v) => void setLocale(v as Locale)}>
                  <DropdownMenuRadioItem value="en">{t("language.english")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zh-cn">{t("language.chinese")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

"use client"

import * as React from "react"
import { ChevronDown, Languages, Laptop, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { useI18n } from "@/components/i18n-provider"
import type { Locale } from "@/lib/shared/i18n/constants"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

function ThemeIcon({ value, className }: { value: string; className?: string }) {
  if (value === "light") return <Sun className={cn("size-4", className)} aria-hidden="true" />
  if (value === "dark") return <Moon className={cn("size-4", className)} aria-hidden="true" />
  return <Laptop className={cn("size-4", className)} aria-hidden="true" />
}

export type AuthAppearanceFooterProps = {
  className?: string
  orientation?: "row" | "stack"
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
  buttonSize?: React.ComponentProps<typeof Button>["size"]
  buttonClassName?: string
  iconClassName?: string
  menuClassName?: string
}

export function AuthAppearanceFooter(props: AuthAppearanceFooterProps) {
  const {
    className,
    orientation = "row",
    buttonVariant = "ghost",
    buttonSize = "sm",
    buttonClassName,
    iconClassName,
    menuClassName,
  } = props
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const themeValue = (mounted ? theme : "system") ?? "system"

  const themeLabel =
    themeValue === "light" ? t("theme.light") : themeValue === "dark" ? t("theme.dark") : t("theme.system")
  const localeLabel = locale === "zh-cn" ? t("language.chinese") : t("language.english")

  const triggerClassName = cn("justify-between", orientation === "stack" ? "w-full" : "flex-1", buttonClassName)

  return (
    <div
      className={cn(
        "flex w-full gap-2",
        orientation === "stack" ? "flex-col items-stretch" : "items-center",
        className,
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={buttonVariant} size={buttonSize} className={triggerClassName}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <ThemeIcon value={themeValue} className={iconClassName} />
              <span className="truncate">{themeLabel}</span>
            </span>
            <ChevronDown className={cn("size-4 opacity-60", iconClassName)} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" sideOffset={8} className={cn("w-44", menuClassName)}>
          <DropdownMenuRadioGroup value={themeValue} onValueChange={(v) => setTheme(v)}>
            <DropdownMenuRadioItem value="system">
              <Laptop className="mr-2 size-4" />
              {t("theme.system")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <Sun className="mr-2 size-4" />
              {t("theme.light")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon className="mr-2 size-4" />
              {t("theme.dark")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={buttonVariant} size={buttonSize} className={triggerClassName}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <Languages className={cn("size-4", iconClassName)} aria-hidden="true" />
              <span className="truncate">{localeLabel}</span>
            </span>
            <ChevronDown className={cn("size-4 opacity-60", iconClassName)} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={8} className={cn("w-44", menuClassName)}>
          <DropdownMenuRadioGroup value={locale} onValueChange={(v) => void setLocale(v as Locale)}>
            <DropdownMenuRadioItem value="en">{t("language.english")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="zh-cn">{t("language.chinese")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

"use client"

import * as React from "react"
import { ArrowRight, Laptop, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import type { Locale } from "@/lib/shared/i18n/constants"
import { LocaleCombobox } from "@/components/common/locale-combobox"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useI18n } from "@/components/i18n-provider"

import { useSetupWizardFooter } from "../footer-context"

export function AppearanceStep({ onNext, active = true }: { onNext: () => void; active?: boolean }) {
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // `next-themes` resolves theme client-side (localStorage/system). Keep initial
  // render deterministic to avoid hydration mismatches.
  const themeValue = (mounted ? theme : "system") ?? "system"

  useSetupWizardFooter(
    () => (
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={onNext}>
          {t("setupWizard.appearance.continueAction")}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    ),
    [onNext, t],
    active,
  )

  return (
    <div className="space-y-2">
      <FieldGroup className="gap-6">
        <Field>
          <FieldLabel className="text-sm font-medium">{t("sidebar.theme")}</FieldLabel>
          <FieldDescription>{t("setupWizard.appearance.themeHint")}</FieldDescription>
          <FieldContent>
            <RadioGroup
              value={themeValue}
              onValueChange={(v) => setTheme(v)}
              className="grid grid-cols-1 gap-3 @md/field-group:grid-cols-3"
            >
              <FieldLabel className="cursor-pointer">
                <Field orientation="horizontal" className="items-start">
                  <FieldContent className="gap-1.5">
                    <div className="flex items-center gap-2 font-medium">
                      <Laptop className="size-4" aria-hidden="true" />
                      {t("theme.system")}
                    </div>
                    <FieldDescription className="text-xs">
                      {t("setupWizard.appearance.themeSystemDesc")}
                    </FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="system" className="mt-1" />
                </Field>
              </FieldLabel>

              <FieldLabel className="cursor-pointer">
                <Field orientation="horizontal" className="items-start">
                  <FieldContent className="gap-1.5">
                    <div className="flex items-center gap-2 font-medium">
                      <Sun className="size-4" aria-hidden="true" />
                      {t("theme.light")}
                    </div>
                    <FieldDescription className="text-xs">
                      {t("setupWizard.appearance.themeLightDesc")}
                    </FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="light" className="mt-1" />
                </Field>
              </FieldLabel>

              <FieldLabel className="cursor-pointer">
                <Field orientation="horizontal" className="items-start">
                  <FieldContent className="gap-1.5">
                    <div className="flex items-center gap-2 font-medium">
                      <Moon className="size-4" aria-hidden="true" />
                      {t("theme.dark")}
                    </div>
                    <FieldDescription className="text-xs">{t("setupWizard.appearance.themeDarkDesc")}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="dark" className="mt-1" />
                </Field>
              </FieldLabel>
            </RadioGroup>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel className="text-sm font-medium">{t("sidebar.language")}</FieldLabel>
          <FieldDescription>{t("setupWizard.appearance.languageHint")}</FieldDescription>
          <FieldContent>
            <LocaleCombobox<Locale>
              items={[
                { value: "en", label: t("language.english"), searchText: "en english" },
                { value: "zh-cn", label: t("language.chinese"), searchText: "zh cn chinese 中文 汉语" },
              ]}
              value={locale}
              onValueChange={(v) => void setLocale(v as Locale)}
              placeholder={t("setupWizard.appearance.languagePlaceholder")}
              searchPlaceholder={t("setupWizard.appearance.languageSearchPlaceholder")}
              emptyText={t("setupWizard.appearance.languageEmpty")}
              className="w-full justify-between"
              menuClassName="w-[var(--radix-popper-anchor-width)]"
            />
          </FieldContent>
        </Field>
      </FieldGroup>
    </div>
  )
}

"use client"

import * as React from "react"

import { BrandedSectionCardLayout } from "@/components/common/branded-section-card-layout"
import { AuthAppearanceFooter } from "@/components/auth/auth-appearance-footer"
import { SectionCard, SectionCardBody, SectionCardFooter } from "@/components/common/section-card"
import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"

export function AuthPageShell(props: {
  titleKey: string
  subtitleKey?: string
  children: React.ReactNode
  className?: string
  cardClassName?: string
  maxWidthClassName?: string
}) {
  const { t } = useI18n()
  const { titleKey, subtitleKey, children, className, cardClassName, maxWidthClassName } = props

  return (
    <BrandedSectionCardLayout
      title={t(titleKey)}
      subtitle={subtitleKey ? t(subtitleKey) : undefined}
      className={className}
    >
      <SectionCard
        className={cn(
          "mx-auto w-full max-w-md bg-card/60 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/50",
          maxWidthClassName,
          cardClassName,
        )}
      >
        <SectionCardBody className="px-4 py-6 sm:px-5 sm:py-8">{children}</SectionCardBody>
        <SectionCardFooter className="px-4 py-3 sm:px-5 sm:py-4 text-sm">
          <AuthAppearanceFooter />
        </SectionCardFooter>
      </SectionCard>
    </BrandedSectionCardLayout>
  )
}

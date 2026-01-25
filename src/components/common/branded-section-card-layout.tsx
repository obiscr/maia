import * as React from "react"

import { MaiaLogo } from "@/components/maia-logo"
import { cn } from "@/lib/utils"

export type BrandedSectionCardLayoutProps = {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /**
   * Override logo area; defaults to `MaiaLogo`.
   */
  logo?: React.ReactNode
  /**
   * Logo wrapper size and rounding.
   * Defaults are tuned to match app sidebar branding.
   */
  logoWrapperClassName?: string
  /**
   * Optional className for the default `MaiaLogo`.
   */
  logoClassName?: string
  /**
   * Optional className for title.
   */
  titleClassName?: string
  /**
   * The card element, typically a `SectionCard`.
   */
  children: React.ReactNode
  className?: string
}

export function BrandedSectionCardLayout(props: BrandedSectionCardLayoutProps) {
  const { title, subtitle, logo, children, className, logoClassName, titleClassName } = props
  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex flex-col items-center text-center">
        <div className="flex flex-col items-center gap-2">
          <div className={cn("grid place-items-center overflow-hidden bg-background/40")}>
            {logo ?? (
              <MaiaLogo
                className={cn("size-12", logoClassName)}
                title={typeof title === "string" ? title : undefined}
              />
            )}
          </div>
          <div className={cn("text-xl font-semibold leading-tight tracking-tight", titleClassName)}>{title}</div>
          {subtitle ? <div className="max-w-xl text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
      </div>

      {children}
    </div>
  )
}

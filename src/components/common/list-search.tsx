"use client"

import * as React from "react"
import { Search, X } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"

export function ListSearch(props: {
  value: string
  placeholder: string
  onChange: (next: string) => void
  onReset: () => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  mobileRight?: React.ReactNode
  desktopRight?: React.ReactNode
}) {
  const { t } = useI18n()
  const { value, placeholder, onChange, onReset, inputRef, mobileRight, desktopRight } = props

  function clearAndFocus() {
    onReset()
    requestAnimationFrame(() => inputRef?.current?.focus())
  }

  const input = (opts: { className?: string }) => (
    <InputGroup className={opts.className}>
      <InputGroupAddon align="inline-start">
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm"
      />
      {value.length ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="ghost" size="icon-xs" className="size-5 rounded-full" onClick={clearAndFocus}>
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("common.resetAction")}</span>
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )

  return (
    <>
      {/* <lg: search + optional inline right controls (mobile + tablet) */}
      <div className="flex items-center gap-2 lg:hidden">
        {input({ className: "h-8 w-auto flex-1 min-w-0 text-sm" })}
        {mobileRight ? <div className="shrink-0">{mobileRight}</div> : null}
      </div>

      {/* >=lg: search + optional right controls (desktop) */}
      <div className="hidden items-center gap-2 lg:flex">
        {input({ className: "h-8 w-full text-sm lg:w-[260px]" })}
        {desktopRight}
      </div>
    </>
  )
}

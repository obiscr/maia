"use client"

import type { ReactNode } from "react"

import { Info } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

export function InfoAlert(props: {
  titleKey?: string
  descriptionKey?: string
  title?: ReactNode
  description?: ReactNode
  className?: string
  icon?: ReactNode
}) {
  const { t } = useI18n()
  const title = props.titleKey ? t(props.titleKey) : props.title
  const desc = props.descriptionKey ? t(props.descriptionKey) : props.description
  const titleText = typeof title === "string" ? title.trim() : title
  const descText = typeof desc === "string" ? desc.trim() : desc

  if (!titleText) return null

  return (
    <Alert variant="default" className={cn("rounded-md", props.className)}>
      {props.icon ?? <Info aria-hidden="true" />}
      <AlertTitle>
        <span className="min-w-0 break-words">{titleText}</span>
      </AlertTitle>
      {descText ? (
        <AlertDescription>
          <span className="min-w-0 break-words">{descText}</span>
        </AlertDescription>
      ) : null}
    </Alert>
  )
}

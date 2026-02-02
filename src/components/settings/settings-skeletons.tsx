"use client"

import * as React from "react"

import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function SettingsFormSkeleton(props: {
  className?: string
  rows?: number
  /** Whether to render a footer row (Reset/Save buttons). */
  withFooter?: boolean
}) {
  const rows = Math.max(1, Math.floor(props.rows ?? 2))
  const withFooter = props.withFooter !== false

  return (
    <div className={cn("space-y-4", props.className)}>
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={`settings-form-sk:${i}`} className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-4 w-72 max-w-[85%]" />
          </div>
        ))}
      </div>

      {withFooter ? <SettingsFooterSkeleton /> : null}
    </div>
  )
}

export function SettingsToggleListSkeleton(props: { className?: string; rows?: number; withFooter?: boolean }) {
  const rows = Math.max(1, Math.floor(props.rows ?? 4))
  const withFooter = props.withFooter !== false

  return (
    <div className={cn("space-y-4", props.className)}>
      <div className="space-y-6">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={`settings-toggle-sk:${i}`} className="flex items-center justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-4 w-56 max-w-[70%]" />
              <Skeleton className="h-4 w-72 max-w-[85%]" />
            </div>
            <Skeleton className="h-6 w-10 rounded-full" />
          </div>
        ))}
      </div>

      {withFooter ? <SettingsFooterSkeleton /> : null}
    </div>
  )
}

export function SettingsFooterSkeleton(props: { className?: string }) {
  return (
    <div className={cn("space-y-3", props.className)}>
      <Separator />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </div>
  )
}

export function SystemPerformanceSectionSkeleton(props: { className?: string }) {
  function PerformanceFieldSkeleton(props: {
    labelWidthClassName?: string
    withMeta?: boolean
    withRecommendedBadge?: boolean
  }) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className={cn("h-4", props.labelWidthClassName ?? "w-40")} />
          {props.withRecommendedBadge ? <Skeleton className="h-6 w-20 rounded-md" /> : null}
        </div>
        <Skeleton className="h-10 w-full rounded-md" />
        {props.withMeta !== false ? <Skeleton className="h-4 w-64 max-w-[85%]" /> : null}
      </div>
    )
  }

  return (
    <div className={cn("space-y-4", props.className)}>
      {/* Hardware badges */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>

      {/* Global + per-run */}
      <div className="grid gap-4 sm:grid-cols-2">
        <PerformanceFieldSkeleton labelWidthClassName="w-32" withRecommendedBadge />
        <PerformanceFieldSkeleton labelWidthClassName="w-40" />
      </div>

      {/* Default timeout */}
      <div className="grid gap-4 sm:grid-cols-2">
        <PerformanceFieldSkeleton labelWidthClassName="w-40" />
      </div>

      {/* Download concurrency + timeout */}
      <div className="grid gap-4 sm:grid-cols-2">
        <PerformanceFieldSkeleton labelWidthClassName="w-32" />
        <PerformanceFieldSkeleton labelWidthClassName="w-40" />
      </div>

      {/* Max bytes */}
      <div className="grid gap-4 sm:grid-cols-2">
        <PerformanceFieldSkeleton labelWidthClassName="w-44" />
      </div>

      <SettingsFooterSkeleton />
    </div>
  )
}

export function SystemSmtpSectionSkeleton(props: { className?: string }) {
  return (
    <div className={cn("space-y-4", props.className)}>
      {/* Enable sending toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-96 max-w-[85%]" />
        </div>
        <Skeleton className="h-4 w-10 rounded-full" />
      </div>

      {/* Host/Port */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>

      {/* Secure toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-72 max-w-[85%]" />
        </div>
        <Skeleton className="h-4 w-10 rounded-full" />
      </div>

      {/* Username/Password */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-9 w-full" />
        </div>
      </div>

      {/* From email/from name */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>

      {/* Test to */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-full max-w-2xl" />
      </div>

      {/* Footer with extra action button */}
      <div className="space-y-3">
        <SettingsFooterSkeleton />
      </div>
    </div>
  )
}

"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination"
import { cn } from "@/lib/utils"

function buildPageModel(page: number, totalPages: number) {
  // 1-indexed page numbers
  const maxButtons = 5
  const pages: Array<number | "ellipsis"> = []
  if (totalPages <= maxButtons + 2) {
    for (let p = 1; p <= totalPages; p++) pages.push(p)
    return pages
  }

  const windowSize = 3
  const start = Math.max(2, page - Math.floor(windowSize / 2))
  const end = Math.min(totalPages - 1, start + windowSize - 1)
  const realStart = Math.max(2, end - windowSize + 1)

  pages.push(1)
  if (realStart > 2) pages.push("ellipsis")
  for (let p = realStart; p <= end; p++) pages.push(p)
  if (end < totalPages - 1) pages.push("ellipsis")
  pages.push(totalPages)
  return pages
}

export type PaginationNavProps = {
  pageIndex: number // 0-indexed
  totalPages: number
  onPageIndexChange: (next: number) => void
  className?: string
  compactOnMobile?: boolean
  previousLabel?: React.ReactNode
  nextLabel?: React.ReactNode
}

export function PaginationNav({
  pageIndex,
  totalPages,
  onPageIndexChange,
  className,
  compactOnMobile = true,
  previousLabel = "Previous page",
  nextLabel = "Next page",
}: PaginationNavProps) {
  const safeTotal = Math.max(1, totalPages)
  const page = Math.min(Math.max(1, pageIndex + 1), safeTotal)
  const canPrev = page > 1
  const canNext = page < safeTotal
  const model = buildPageModel(page, safeTotal)

  function goto(p: number) {
    const next = Math.min(Math.max(1, p), safeTotal) - 1
    onPageIndexChange(next)
  }

  return (
    <Pagination className={className}>
      <PaginationContent className={cn(compactOnMobile ? "sm:gap-1" : "")}>
        <PaginationItem>
          <PaginationLink
            asChild
            size="default"
            className={cn("gap-1 px-2.5", !canPrev ? "opacity-50" : "")}
            aria-label="Go to previous page"
          >
            <button type="button" disabled={!canPrev} onClick={() => goto(page - 1)}>
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span>{previousLabel}</span>
            </button>
          </PaginationLink>
        </PaginationItem>

        <PaginationItem className={cn(compactOnMobile ? "sm:hidden" : "hidden")}>
          <PaginationLink asChild isActive>
            <button type="button" disabled>
              {page}
            </button>
          </PaginationLink>
        </PaginationItem>

        {model.map((it, idx) =>
          it === "ellipsis" ? (
            <PaginationItem key={`e:${idx}`} className={cn(compactOnMobile ? "hidden sm:list-item" : "")}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={`p:${it}`} className={cn(compactOnMobile ? "hidden sm:list-item" : "")}>
              <PaginationLink asChild size="sm" isActive={it === page}>
                <button type="button" onClick={() => goto(it)} aria-label={`Go to page ${it}`}>
                  {it}
                </button>
              </PaginationLink>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          <PaginationLink
            asChild
            size="default"
            className={cn("gap-1 px-2.5", !canNext ? "opacity-50" : "")}
            aria-label="Go to next page"
          >
            <button type="button" disabled={!canNext} onClick={() => goto(page + 1)}>
              <span>{nextLabel}</span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

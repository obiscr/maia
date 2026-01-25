"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export function PageBlocker({
  active,
  className,
  zIndexClassName = "z-[60]",
}: {
  active: boolean;
  className?: string;
  /**
   * Tailwind z-index utility class.
   * Default is above Radix `Sheet`/`Dialog` (which typically uses `z-50`).
   */
  zIndexClassName?: string;
}) {
  if (!active) return null;
  return (
    <div
      data-slot="page-blocker"
      aria-hidden="true"
      className={cn("fixed inset-0 cursor-wait bg-transparent", zIndexClassName, className)}
    />
  );
}



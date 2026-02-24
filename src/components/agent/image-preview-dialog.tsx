"use client"

import * as React from "react"
import { Copy, Download, ExternalLink, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type ImagePreviewItem = {
  src: string
  filename: string
  mediaType?: string
}

export function ImagePreviewDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ImagePreviewItem
  onDownload: () => void
  onCopy: () => void
  onOpenInNewTab: () => void
  t: (k: string) => string
}) {
  const title = String(props.item.filename || "").trim()
  const src = String(props.item.src || "")
  const [loaded, setLoaded] = React.useState(false)
  const [errored, setErrored] = React.useState(false)

  React.useEffect(() => {
    setLoaded(false)
    setErrored(false)
  }, [src, props.open])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "!top-0 !left-0 !translate-x-0 !translate-y-0 !w-screen !h-screen !max-w-none !rounded-none !border-0 !p-0",
          "bg-white/50 dark:bg-black/50",
        )}
      >
        <DialogTitle className="sr-only">
          {title || props.t("workflows.orchestrator.attachments.fallbackImageName")}
        </DialogTitle>

        <div
          className="relative h-full w-full"
          role="button"
          tabIndex={-1}
          onClick={() => props.onOpenChange(false)}
          onKeyDown={() => {}}
        >
          <div
            className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0 text-sm text-foreground dark:text-white/90">
              <div className="truncate">{title || props.t("workflows.orchestrator.attachments.fallbackImageName")}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={props.onDownload}>
                <Download className="mr-2 size-4" />
                {props.t("common.downloadAction")}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={props.onCopy}>
                <Copy className="mr-2 size-4" />
                {props.t("common.copyAction")}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={props.onOpenInNewTab}>
                <ExternalLink className="mr-2 size-4" />
                {props.t("common.openAction")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                onClick={() => props.onOpenChange(false)}
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className="absolute inset-0 grid place-items-center p-6 pt-16" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={title || props.item.filename || ""}
              loading="eager"
              decoding="async"
              className={cn(
                "max-h-[calc(100vh-7rem)] max-w-[calc(100vw-3rem)] object-contain transition-opacity",
                loaded ? "opacity-100" : "opacity-0",
              )}
              onLoad={() => setLoaded(true)}
              onError={() => setErrored(true)}
            />
            {!loaded && !errored ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center pt-16">
                <div className="rounded-md bg-white/80 px-3 py-2 text-sm text-foreground dark:bg-black/30 dark:text-white/90">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-foreground/55 border-t-transparent dark:border-white/60" />
                    {props.t("common.loading")}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

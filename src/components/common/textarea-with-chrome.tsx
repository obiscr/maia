import * as React from "react"

import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"

type TextareaWithChromeProps = React.ComponentProps<"textarea"> & {
  /** ClassName applied to the outer (rounded, clipped) container. */
  containerClassName?: string
}

function TextareaWithChrome({ className, containerClassName, ...props }: TextareaWithChromeProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-input overflow-hidden shadow-xs transition-[color,box-shadow] outline-none",
        "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
        "has-[[data-slot=textarea][aria-invalid=true]]:ring-destructive/20 has-[[data-slot=textarea][aria-invalid=true]]:border-destructive dark:has-[[data-slot=textarea][aria-invalid=true]]:ring-destructive/40",
        containerClassName,
      )}
    >
      <Textarea {...props} className={cn("border-0 shadow-none focus-visible:ring-0 rounded-none", className)} />
    </div>
  )
}

export { TextareaWithChrome }

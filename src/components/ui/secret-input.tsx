import * as React from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * A "secret" input that avoids `type="password"` (so browsers/password managers
 * don't treat it as a password field), but can still visually mask the value.
 *
 * Notes:
 * - Masking uses `-webkit-text-security`, supported in Chromium/Safari.
 * - Other browsers will show plain text when masked; we add common ignore flags
 *   for password managers to reduce unwanted prompts/autofill.
 */
export function SecretInput({
  masked = true,
  className,
  style,
  autoComplete,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & { masked?: boolean }) {
  const nextStyle: React.CSSProperties = {
    ...style,
    ...(masked ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined),
  }

  return (
    <Input
      {...props}
      type="text"
      autoComplete={autoComplete ?? "off"}
      data-lpignore="true"
      data-1p-ignore="true"
      data-bwignore="true"
      spellCheck={props.spellCheck ?? false}
      style={nextStyle}
      className={cn(className)}
    />
  )
}


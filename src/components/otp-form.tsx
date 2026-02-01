"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { useApiErrorToast } from "@/hooks/use-api-error-toast"

function normalizeRecoveryCode(input: string) {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
}

function formatRecoveryCodeForDisplay(input: string) {
  const clean = normalizeRecoveryCode(input)
  // 10 chars -> XXXXX-XXXXX (fallback: return clean)
  if (clean.length === 10) return `${clean.slice(0, 5)}-${clean.slice(5)}`
  return clean
}

export function OTPForm({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useI18n()
  const { toastApiError } = useApiErrorToast()
  const router = useRouter()
  const [mode, setMode] = React.useState<"totp" | "recovery">("totp")
  const [otp, setOtp] = React.useState("")
  const [recovery, setRecovery] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  const recoveryClean = normalizeRecoveryCode(recovery)
  const canSubmit = mode === "totp" ? otp.trim().length === 6 : recoveryClean.length >= 8

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || !canSubmit) return
    setSubmitting(true)
    try {
      const challengeId = sessionStorage.getItem("maia_pending_challenge") || ""
      if (!challengeId) {
        router.replace("/signin")
        router.refresh()
        return
      }
      const code = mode === "recovery" ? recoveryClean : otp
      await apiFetchJson("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      })
      try {
        sessionStorage.removeItem("maia_pending_challenge")
        sessionStorage.removeItem("maia_pending_email")
      } catch {}
      router.replace("/")
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError && err.code === "TOTP_INVALID") toast.error(t("auth.otp.errors.invalidCode"))
      else if (err instanceof ApiError && err.code === "CHALLENGE_INVALID")
        toast.error(t("auth.otp.errors.sessionExpired"))
      else toastApiError(err, "auth.otp.errors.verifyFailed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            {mode === "totp" ? (
              <>
                <InputOTP
                  maxLength={6}
                  id="otp"
                  required
                  value={otp}
                  onChange={setOtp}
                  disabled={submitting}
                  aria-label={t("auth.otp.codeLabel")}
                >
                  <InputOTPGroup className="mx-auto w-fit justify-center gap-2.5 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border">
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
                <FieldDescription className="mx-auto max-w-xs text-center">{t("auth.otp.codeHint")}</FieldDescription>
              </>
            ) : (
              <>
                <div className="mx-auto w-full max-w-xs">
                  <FieldLabel htmlFor="recovery-code" className="sr-only">
                    {t("auth.otp.recoveryCodeLabel")}
                  </FieldLabel>
                  <Input
                    id="recovery-code"
                    required
                    value={recovery}
                    onChange={(e) => setRecovery(formatRecoveryCodeForDisplay(e.target.value))}
                    onPaste={(e) => {
                      const raw = e.clipboardData?.getData("text") ?? ""
                      if (!raw) return
                      e.preventDefault()
                      setRecovery(formatRecoveryCodeForDisplay(raw))
                    }}
                    disabled={submitting}
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="text"
                    className="font-mono text-xs"
                    aria-label={t("auth.otp.recoveryCodeLabel")}
                    placeholder={t("auth.otp.recoveryCodePlaceholder")}
                  />
                </div>
                <FieldDescription className="mx-auto max-w-xs text-center">
                  {t("auth.otp.recoveryCodeHint")}
                </FieldDescription>
              </>
            )}
          </Field>
          <FieldGroup>
            <Button className="w-full" type="submit" disabled={submitting || !canSubmit}>
              {t("auth.otp.submitAction")}
            </Button>
            <FieldDescription className="text-center">
              {mode === "totp" ? t("auth.otp.noCode") : t("auth.otp.noRecovery")}{" "}
              <Button
                type="button"
                variant="ghost"
                className={[
                  "h-auto p-0",
                  "inline-block",
                  "text-[inherit] font-[inherit]",
                  "underline underline-offset-4 hover:no-underline",
                  "hover:bg-transparent hover:text-[inherit]",
                ].join(" ")}
                onClick={() => {
                  setOtp("")
                  setRecovery("")
                  setMode((m) => (m === "totp" ? "recovery" : "totp"))
                }}
              >
                {mode === "totp" ? t("auth.otp.recoveryCodeAction") : t("auth.otp.authenticatorCodeAction")}
              </Button>
            </FieldDescription>
          </FieldGroup>
        </FieldGroup>
      </form>
    </div>
  )
}

import { OTPForm } from "@/components/otp-form"
import { AuthPageShell } from "@/components/auth/auth-page-shell"

export default function OTPPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <AuthPageShell titleKey="auth.otp.title">
          <OTPForm />
        </AuthPageShell>
      </div>
    </div>
  )
}

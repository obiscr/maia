import { redirect } from "next/navigation"

import { SignupForm } from "@/components/signup-form"
import { AuthPageShell } from "@/components/auth/auth-page-shell"
import { getInstallation, getRegistrationMode } from "@/lib/server/installation"

export default async function Page() {
  const installed = await getInstallation()
    .then((i) => Boolean(i?.installedAt))
    .catch(() => false)
  if (!installed) redirect("/setup")

  const mode = await getRegistrationMode().catch(() => "DISABLED" as const)
  if (mode !== "OPEN") {
    const reason = mode === "INVITE_ONLY" ? "invite_only" : "registration_disabled"
    redirect(`/signin?reason=${reason}`)
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <AuthPageShell titleKey="auth.signup.title" subtitleKey="auth.signup.subtitle">
          <SignupForm />
        </AuthPageShell>
      </div>
    </div>
  )
}

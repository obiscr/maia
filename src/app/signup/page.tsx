import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SignupForm } from "@/components/signup-form"
import { AuthPageShell } from "@/components/auth/auth-page-shell"
import { getT } from "@/lib/server/i18n/server"
import { getInstallation, getRegistrationMode } from "@/lib/server/installation"

type SearchParams = Record<string, string | string[] | undefined>

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t("auth.signup.title") }
}

export default async function Page({ searchParams }: { searchParams?: SearchParams }) {
  const installed = await getInstallation()
    .then((i) => Boolean(i?.installedAt))
    .catch(() => false)
  if (!installed) redirect("/setup")

  const sp = await Promise.resolve(searchParams ?? {})
  const inviteToken = typeof sp.invite === "string" ? String(sp.invite ?? "").trim() : ""
  const inviteEmail = typeof sp.email === "string" ? String(sp.email ?? "").trim() : ""

  const mode = await getRegistrationMode().catch(() => "DISABLED" as const)
  if (mode !== "OPEN") {
    // Allow invite-only registration when a valid invite link is present.
    if (!((mode === "INVITE_ONLY" && inviteToken) || (mode === "DISABLED" && inviteToken))) {
      const reason = mode === "INVITE_ONLY" ? "invite_only" : "registration_disabled"
      redirect(`/signin?reason=${reason}`)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <AuthPageShell titleKey="auth.signup.title" subtitleKey="auth.signup.subtitle">
          <SignupForm inviteToken={inviteToken || undefined} initialEmail={inviteEmail || undefined} />
        </AuthPageShell>
      </div>
    </div>
  )
}

import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthPageShell } from "@/components/auth/auth-page-shell"
import { RepairForm } from "@/components/repair-form"
import { prisma } from "@/lib/server/db"
import { getT } from "@/lib/server/i18n/server"
import { getInstallation } from "@/lib/server/installation"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t("auth.repair.title") }
}

export default async function Page() {
  const [installed, userCount] = await Promise.all([
    getInstallation()
      .then((i) => Boolean(i?.installedAt))
      .catch(() => false),
    prisma.user.count().catch(() => 0),
  ])

  if (!installed) redirect("/setup")
  if (userCount > 0) redirect("/auth/redirect")

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <AuthPageShell titleKey="auth.repair.title" subtitleKey="auth.repair.subtitle">
          <RepairForm />
        </AuthPageShell>
      </div>
    </div>
  )
}

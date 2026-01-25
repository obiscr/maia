import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("settings.system.title"),
    description: t("settings.system.description"),
  }
}

export default async function Page() {
  redirect("/preference/system/registration")
}

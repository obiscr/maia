import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t("auth.reset.title") }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"

import { apiFetchJson } from "@/lib/shared/http/api"
import { NavUser } from "@/components/nav-user"

type AuthStatusResponse = {
  user: {
    id: string
    email: string
    name: string | null
    role?: string
  } | null
}

function avatarUrlFromEmail(email: string) {
  const seed = encodeURIComponent(
    String(email ?? "")
      .trim()
      .toLowerCase(),
  )
  // DiceBear: deterministic avatar from seed. (No hashing needed.)
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${seed}`
}

export function SidebarUserMenu() {
  const statusQuery = useQuery({
    queryKey: ["auth", "status"],
    queryFn: async () => apiFetchJson<AuthStatusResponse>("/api/auth/status", { cache: "no-store" }),
    staleTime: 30_000,
  })

  const user = statusQuery.data?.user ?? null
  if (!user) return null

  const displayName = (user.name ?? "").trim() || user.email.split("@")[0] || "User"
  const avatar = avatarUrlFromEmail(user.email)

  return <NavUser user={{ name: displayName, email: user.email, avatar, role: String(user.role ?? "") }} />
}

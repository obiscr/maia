"use client"

import { useQuery } from "@tanstack/react-query"

import { apiFetchJson } from "@/lib/shared/http/api"
import { normalizeRole, type Viewer } from "@/lib/shared/viewer"

type AuthStatusResponse = {
  user: { id: string; publicId: string; email: string; name: string | null; role?: string } | null
}

export function useViewer(): Viewer | null {
  const { data } = useQuery({
    queryKey: ["auth", "status"],
    queryFn: () => apiFetchJson<AuthStatusResponse>("/api/auth/status", { cache: "no-store" }),
    staleTime: 30_000,
  })

  const user = data?.user ?? null
  if (!user) return null

  return { publicId: user.publicId, role: normalizeRole(user.role) }
}

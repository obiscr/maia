"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { clampInt, normalizeAllowedInt, safeWriteLocalStorageJson } from "@/hooks/list-page-utils"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { useListQueryState } from "@/hooks/list-query/use-list-query-state"
import { usePageSizePreferenceOnce } from "@/hooks/use-page-size-preference"

export type AdminUserRow = {
  id: string
  publicId: string
  publicNumber: number
  email: string
  name: string | null
  role: string
  totpEnabled: boolean
  isDisabled: boolean
  activeSessions: number
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export type AdminUsersSortKey = "CREATED_DESC" | "CREATED_ASC"
export type AdminUsersRoleFilter = "ANY" | "ADMIN" | "MEMBER"
export type AdminUsersDisabledFilter = "ANY" | "ACTIVE" | "DISABLED"

const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const
type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number]
const DEFAULT_PAGE_SIZE: AllowedPageSize = 20

const USERS_LS_PAGE_SIZE_KEY = "maia.admin.users.pageSize.v1"
function normalizePageSize(raw: unknown): AllowedPageSize {
  return normalizeAllowedInt(raw, ALLOWED_PAGE_SIZES, DEFAULT_PAGE_SIZE)
}

export function useAdminUsersPage() {
  const { t } = useI18n()

  type State = {
    qDraft: string
    q: string
    role: AdminUsersRoleFilter
    disabled: AdminUsersDisabledFilter
    sort: AdminUsersSortKey
    pageSize: AllowedPageSize
    pageIndex: number
  }

  const { state, setState, didInit } = useListQueryState<State>({
    basePath: "/admin/users",
    defaults: {
      qDraft: "",
      q: "",
      role: "ANY",
      disabled: "ANY",
      sort: "CREATED_DESC",
      pageSize: DEFAULT_PAGE_SIZE,
      pageIndex: 0,
    },
    codec: {
      parse: (qp) => {
        const patch: Partial<State> = {}
        const q = qp.get("q")
        if (typeof q === "string" && q.trim()) {
          patch.qDraft = q
          patch.q = q
        }
        const role = qp.get("role")
        if (role === "ADMIN" || role === "MEMBER") patch.role = role
        const disabled = qp.get("disabled")
        if (disabled === "ACTIVE" || disabled === "DISABLED") patch.disabled = disabled

        const sortRaw = qp.get("sort")
        if (sortRaw === "CREATED_ASC" || sortRaw === "CREATED_DESC") patch.sort = sortRaw

        const pageSizeRaw = qp.get("pageSize")
        if (pageSizeRaw != null) patch.pageSize = normalizePageSize(pageSizeRaw)

        const pageRaw = qp.get("page")
        const initialPage = pageRaw ? Number(pageRaw) : 1
        patch.pageIndex = Math.max(0, clampInt(initialPage, 1, 10_000) - 1)

        return patch
      },
      serialize: (s, qp) => {
        const q = s.q.trim()
        if (q) qp.set("q", q)
        else qp.delete("q")
        if (s.role !== "ANY") qp.set("role", s.role)
        else qp.delete("role")
        if (s.disabled !== "ANY") qp.set("disabled", s.disabled)
        else qp.delete("disabled")
        if (s.sort !== "CREATED_DESC") qp.set("sort", s.sort)
        else qp.delete("sort")
        if (s.pageSize !== DEFAULT_PAGE_SIZE) qp.set("pageSize", String(s.pageSize))
        else qp.delete("pageSize")
        if (s.pageIndex > 0) qp.set("page", String(s.pageIndex + 1))
        else qp.delete("page")
        return qp
      },
    },
    resetPageIndexDeps: [(s) => s.q, (s) => s.role, (s) => s.disabled, (s) => s.sort, (s) => s.pageSize],
    onResetPageIndex: () => setState((prev) => ({ ...prev, pageIndex: 0 })),
    urlMode: { strategy: "replaceState", kind: "replace" },
  })

  React.useEffect(() => {
    if (!didInit) return
    const tmr = window.setTimeout(() => {
      setState((prev) => (prev.q === prev.qDraft ? prev : { ...prev, q: prev.qDraft }))
    }, 250)
    return () => window.clearTimeout(tmr)
  }, [didInit, setState, state.qDraft])

  usePageSizePreferenceOnce<AllowedPageSize>({
    didInit,
    storageKey: USERS_LS_PAGE_SIZE_KEY,
    normalize: normalizePageSize,
    getCurrent: () => state.pageSize,
    setNext: (next) => setState((prev) => (prev.pageSize === next ? prev : { ...prev, pageSize: next })),
  })

  React.useEffect(() => {
    if (!didInit) return
    safeWriteLocalStorageJson(USERS_LS_PAGE_SIZE_KEY, state.pageSize)
  }, [didInit, state.pageSize])

  const query = useListQuery<{ users: AdminUserRow[]; total: number }>({
    queryKey: [
      "admin",
      "users",
      {
        q: state.q.trim(),
        role: state.role,
        disabled: state.disabled,
        sort: state.sort,
        pageIndex: state.pageIndex,
        pageSize: state.pageSize,
      },
    ],
    enabled: true,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      params.set("page", String(state.pageIndex + 1))
      params.set("pageSize", String(state.pageSize))
      params.set("sort", state.sort)
      const q = state.q.trim()
      if (q) params.set("q", q)
      if (state.role !== "ANY") params.set("role", state.role)
      if (state.disabled !== "ANY") params.set("disabled", state.disabled)
      return await apiFetchJson(`/api/admin/users?${params.toString()}`, { cache: "no-store", signal })
    },
  })

  const users = Array.isArray(query.data?.users) ? (query.data?.users as AdminUserRow[]) : []
  const total = Number(query.data?.total) || 0
  const hasData = !!query.data
  const initialLoading = query.isLoading && !hasData
  const refreshing = query.isFetching && hasData
  const loading = initialLoading
  const loadError = (query.error ?? null) as unknown

  const totalPages = React.useMemo(() => Math.max(1, Math.ceil(total / state.pageSize)), [total, state.pageSize])
  const safePageIndex = React.useMemo(() => Math.min(state.pageIndex, totalPages - 1), [state.pageIndex, totalPages])
  const pageRows = users

  React.useEffect(() => {
    if (!didInit) return
    if (state.pageIndex !== safePageIndex) setState((prev) => ({ ...prev, pageIndex: safePageIndex }))
  }, [didInit, safePageIndex, setState, state.pageIndex])

  const refresh = React.useCallback(async () => {
    await query.refetch()
  }, [query])

  async function copyText(text: string) {
    try {
      await copyTextToClipboard(text)
      toast(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  async function revokeSessions(userPublicId: string) {
    try {
      const res = await apiFetchJson<{ ok?: boolean; revokedCount?: number }>(
        `/api/admin/users/${userPublicId}/sessions/revoke`,
        {
          method: "POST",
        },
      )
      const n = Number(res?.revokedCount ?? 0)
      toast.success(t("admin.users.kickSuccess", { count: n }))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "admin.users.kickFailed" }))
      throw e
    } finally {
      await refresh()
    }
  }

  async function createResetLink(userPublicId: string) {
    try {
      const res = await apiFetchJson<{ ok?: boolean; resetUrl?: string }>(
        `/api/admin/users/${userPublicId}/password/reset`,
        {
          method: "POST",
        },
      )
      const url = String(res?.resetUrl ?? "").trim()
      if (url) {
        await copyTextToClipboard(url)
        toast.success(t("admin.users.resetLinkCopied"))
      } else {
        toast.success(t("admin.users.resetLinkCreated"))
      }
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "admin.users.resetFailed" }))
      throw e
    }
  }

  return {
    total,
    search: state.qDraft,
    role: state.role,
    disabled: state.disabled,
    sort: state.sort,
    loading,
    refreshing,
    loadError,
    pageSize: state.pageSize,
    totalPages,
    safePageIndex,
    pageRows,
    setSearch: (next: string) => setState((prev) => ({ ...prev, qDraft: next })),
    setRole: (next: AdminUsersRoleFilter) => setState((prev) => ({ ...prev, role: next })),
    setDisabled: (next: AdminUsersDisabledFilter) => setState((prev) => ({ ...prev, disabled: next })),
    setSort: (next: AdminUsersSortKey) => setState((prev) => ({ ...prev, sort: next })),
    setPageIndex: (n: number) => setState((prev) => ({ ...prev, pageIndex: Math.max(0, Math.floor(n)) })),
    refresh,
    copyText,
    revokeSessions,
    createResetLink,
  }
}

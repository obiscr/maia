"use client"

import * as React from "react"
import { ArrowDownNarrowWide, ArrowUpNarrowWide, Shield, User as UserIcon } from "lucide-react"

import { StandardListPage } from "@/components/common/standard-list-page"
import { NavMenuFilter, NavMenuFilters, type NavMenuFilterOption } from "@/components/common/nav-menu-filters"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { StandardConfirmDialog } from "@/components/common/standard-confirm-dialog"
import { useI18n } from "@/components/i18n-provider"
import { useLoadErrorAlert } from "@/hooks/use-load-error-alert"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { AdminUsersCommonListItem } from "@/components/admin/users/list/admin-users-common-list-item"
import { AdminUsersListPageSkeleton } from "@/components/admin/users/list/admin-users-list-page-skeleton"
import {
  useAdminUsersPage,
  type AdminUserRow,
  type AdminUsersDisabledFilter,
  type AdminUsersRoleFilter,
  type AdminUsersSortKey,
} from "@/components/admin/users/hooks/use-admin-users-page"

export default function AdminUsersPage() {
  const { t, locale } = useI18n()
  const [filtersOpen, setFiltersOpen] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)

  const {
    total,
    search,
    role,
    disabled,
    sort,
    loading,
    refreshing,
    loadError,
    pageSize,
    totalPages,
    safePageIndex,
    pageRows,
    setSearch,
    setRole,
    setDisabled,
    setSort,
    setPageIndex,
    refresh,
    copyText,
    revokeSessions,
    createResetLink,
  } = useAdminUsersPage()

  const loadErrorAlert = useLoadErrorAlert(loadError, [
    { key: "refresh", label: t("common.refreshAction"), onClick: () => void refresh() },
  ])

  const skeletonCount = Math.min(pageSize, 10)
  const { listItems } = useStableListRows({ rows: pageRows, loading, skeletonCount })
  const busy = loading || refreshing

  const [kickUserId, setKickUserId] = React.useState<string | null>(null)
  const [kickPending, setKickPending] = React.useState(false)

  const [resetUserId, setResetUserId] = React.useState<string | null>(null)
  const [resetPending, setResetPending] = React.useState(false)

  const filtersActive = !!search.trim() || role !== "ANY" || disabled !== "ANY" || sort !== "CREATED_DESC"

  function clearFilters() {
    setFiltersOpen("")
    setSearch("")
    setRole("ANY")
    setDisabled("ANY")
    setSort("CREATED_DESC")
    setPageIndex(0)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  const sortOpts: NavMenuFilterOption[] = [
    {
      value: "CREATED_DESC",
      label: t("common.sortNewest"),
      icon: <ArrowDownNarrowWide className="text-muted-foreground" aria-hidden="true" />,
    },
    {
      value: "CREATED_ASC",
      label: t("common.sortOldest"),
      icon: <ArrowUpNarrowWide className="text-muted-foreground" aria-hidden="true" />,
    },
  ]

  const roleOpts: NavMenuFilterOption[] = [
    { value: "ANY", label: t("common.any") },
    {
      value: "ADMIN",
      label: t("admin.users.roleValues.admin"),
      icon: <Shield className="text-primary" aria-hidden="true" />,
    },
    {
      value: "MEMBER",
      label: t("admin.users.roleValues.member"),
      icon: <UserIcon className="text-muted-foreground" aria-hidden="true" />,
    },
  ]

  const disabledOpts: NavMenuFilterOption[] = [
    { value: "ANY", label: t("common.any") },
    { value: "ACTIVE", label: t("admin.users.filters.active") },
    { value: "DISABLED", label: t("admin.users.filters.disabled") },
  ]

  const listFilters = (opts: { className?: string; disabled?: boolean }) => (
    <NavMenuFilters
      value={filtersOpen}
      onValueChange={setFiltersOpen}
      triggerMode="click"
      contentAlign="start"
      className={opts.className}
      listClassName={opts.className}
    >
      <NavMenuFilter
        menuValue="sort"
        label={t("common.sort")}
        showValueInTrigger={false}
        selectedValue={sort}
        options={sortOpts}
        onSelectValue={(v) => setSort(v as AdminUsersSortKey)}
        closeMenu={() => setFiltersOpen("")}
        disabled={opts.disabled}
      />
      <NavMenuFilter
        menuValue="role"
        label={t("admin.users.filters.role")}
        showValueInTrigger={false}
        selectedValue={role}
        options={roleOpts}
        onSelectValue={(v) => setRole(v as AdminUsersRoleFilter)}
        closeMenu={() => setFiltersOpen("")}
        disabled={opts.disabled}
      />
      <NavMenuFilter
        menuValue="disabled"
        label={t("admin.users.filters.account")}
        showValueInTrigger={false}
        selectedValue={disabled}
        options={disabledOpts}
        onSelectValue={(v) => setDisabled(v as AdminUsersDisabledFilter)}
        closeMenu={() => setFiltersOpen("")}
        disabled={opts.disabled}
      />
    </NavMenuFilters>
  )

  async function doKick() {
    if (!kickUserId || kickPending) return
    setKickPending(true)
    try {
      await revokeSessions(kickUserId)
    } finally {
      setKickPending(false)
      setKickUserId(null)
    }
  }

  async function doResetLink() {
    if (!resetUserId || resetPending) return
    setResetPending(true)
    try {
      await createResetLink(resetUserId)
    } finally {
      setResetPending(false)
      setResetUserId(null)
    }
  }

  // ---- Hooks must stay above any conditional returns (Rules of Hooks). ----
  if (loading && pageRows.length === 0) {
    return <AdminUsersListPageSkeleton rows={skeletonCount} />
  }

  return (
    <StandardListPage<AdminUserRow>
      alert={loadErrorAlert}
      modals={
        <>
          <StandardConfirmDialog
            open={!!kickUserId}
            onOpenChange={(o) => !kickPending && !o && setKickUserId(null)}
            title={t("admin.users.kickTitle")}
            description={t("admin.users.kickDescription")}
            confirmText={kickPending ? t("common.loading") : t("admin.users.kickConfirmAction")}
            confirmVariant="destructive"
            onConfirm={doKick}
            pending={kickPending}
          />
          <StandardConfirmDialog
            open={!!resetUserId}
            onOpenChange={(o) => !resetPending && !o && setResetUserId(null)}
            title={t("admin.users.resetTitle")}
            description={t("admin.users.resetDescription")}
            confirmText={resetPending ? t("common.loading") : t("admin.users.resetConfirmAction")}
            onConfirm={doResetLink}
            pending={resetPending}
          />
        </>
      }
      title={t("admin.users.title")}
      description={t("admin.users.description")}
      search={{
        value: search,
        placeholder: t("admin.users.searchPlaceholder"),
        inputRef: searchInputRef,
        onChange: setSearch,
        onReset: () => {
          setSearch("")
          setPageIndex(0)
        },
      }}
      mobileBar={{
        left: (
          <div className="text-sm font-medium text-muted-foreground lg:hidden">
            {t("admin.users.showingTotal", { total })}
          </div>
        ),
      }}
      listHeader={{
        left: (
          <div className="hidden lg:block text-sm font-medium text-muted-foreground">
            {t("admin.users.showingTotal", { total })}
          </div>
        ),
        right: (
          <div className="w-full lg:w-auto">
            {listFilters({ className: "justify-start lg:justify-end", disabled: busy })}
          </div>
        ),
      }}
      emptyState={{
        loading,
        filtersActive,
        empty: t("admin.users.emptyState"),
        noResultsTitle: t("admin.users.noResultsTitle"),
        noResultsDescription: t("common.list.noResultsDescription"),
        clearFiltersLabel: t("common.filters.clearAction"),
        onClearFilters: clearFilters,
      }}
      list={{
        items: listItems,
        getRowKey: (it) => it.publicId,
        renderSkeleton: (idx) => <CommonListItemSkeleton key={`skwrap:${idx}`} />,
        renderRow: (it) => (
          <AdminUsersCommonListItem
            key={it.publicId}
            locale={locale}
            model={{
              id: it.publicId,
              email: it.email,
              name: it.name ?? null,
              role: it.role,
              isDisabled: !!it.isDisabled,
              totpEnabled: !!it.totpEnabled,
              activeSessions: Number(it.activeSessions ?? 0),
              lastSeenAt: it.lastSeenAt ?? null,
              createdAt: it.createdAt,
              updatedAt: it.updatedAt,
            }}
            actions={{
              copyId: () => copyText(it.publicId),
              kick: () => setKickUserId(it.publicId),
              resetPassword: () => setResetUserId(it.publicId),
            }}
          />
        ),
      }}
      pagination={{
        pageIndex: safePageIndex,
        totalPages,
        onPageIndexChange: setPageIndex,
        compactOnMobile: true,
        previousLabel: t("common.prevPageAction"),
        nextLabel: t("common.nextPageAction"),
      }}
    />
  )
}

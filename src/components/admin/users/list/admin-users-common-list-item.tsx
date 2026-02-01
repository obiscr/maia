"use client"

import * as React from "react"
import { Calendar, Clock3, Copy, KeyRound, LogOut, Mail, MoreHorizontal, Shield, User as UserIcon } from "lucide-react"

import { CommonListItem } from "@/components/common/common-list-item"
import { CopyableIdBadge } from "@/components/common/copyable-id-badge"
import { InlineItemRow, type InlineItemRowItem } from "@/components/common/inline-item-row"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/components/i18n-provider"
import type { Locale } from "@/lib/shared/i18n/constants"
import { formatRelativeTimeFromNow } from "@/lib/shared/format/time"
import { cn } from "@/lib/utils"

export type AdminUsersListItemModel = {
  id: string
  email: string
  emailVerifiedAt: string | null
  name: string | null
  role: string
  isDisabled: boolean
  totpEnabled: boolean
  activeSessions: number
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export type AdminUsersListItemActions = {
  copyId?: () => void | Promise<void>
  kick?: () => void | Promise<void>
  resetPassword?: () => void | Promise<void>
}

export function AdminUsersCommonListItem(props: {
  locale: Locale
  model: AdminUsersListItemModel
  actions?: AdminUsersListItemActions
}) {
  const { t } = useI18n()
  const u = props.model
  const isAdmin = String(u.role).toUpperCase() === "ADMIN"
  const emailVerified = Boolean(u.emailVerifiedAt)

  const title = (u.name ?? "").trim() || u.email
  const createdRel = formatRelativeTimeFromNow(u.createdAt, { locale: props.locale })
  const lastSeenRel = u.lastSeenAt ? formatRelativeTimeFromNow(u.lastSeenAt, { locale: props.locale }) : null

  const BadgeIcon = isAdmin ? Shield : UserIcon
  const roleLabel = isAdmin ? t("admin.users.roleValues.admin") : t("admin.users.roleValues.member")

  const metaItems = React.useMemo((): InlineItemRowItem[] => {
    const items: InlineItemRowItem[] = []
    items.push({
      key: "role",
      title: "Role",
      Icon: BadgeIcon,
      text: <span className={cn("font-mono text-[11px]", isAdmin ? "text-primary" : "")}>{roleLabel}</span>,
    })
    items.push({
      key: "sessions",
      title: "Active sessions",
      Icon: LogOut,
      text: <span className="font-mono text-[11px]">{Math.max(0, Number(u.activeSessions) || 0)}</span>,
    })
    items.push({
      key: "emailVerified",
      title: "Email verification",
      Icon: Mail,
      iconClassName: emailVerified ? "text-primary" : "text-muted-foreground",
      text: (
        <span className={cn("font-mono text-[11px]", emailVerified ? "text-primary" : "text-muted-foreground")}>
          {emailVerified
            ? t("admin.users.emailVerificationValues.verified")
            : t("admin.users.emailVerificationValues.unverified")}
        </span>
      ),
    })
    if (u.totpEnabled) {
      items.push({
        key: "totp",
        title: "2FA",
        Icon: KeyRound,
        text: <span className="font-mono text-[11px]">2FA</span>,
      })
    }
    if (u.isDisabled) {
      items.push({
        key: "disabled",
        title: "Disabled",
        Icon: UserIcon,
        iconClassName: "text-muted-foreground",
        text: <span className="font-mono text-[11px] text-muted-foreground">DISABLED</span>,
      })
    }
    return items
  }, [BadgeIcon, emailVerified, isAdmin, roleLabel, t, u.activeSessions, u.isDisabled, u.totpEnabled])

  const leftColumn = (
    <ItemContent className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0">
          <BadgeIcon
            className={cn("size-4.5", isAdmin ? "text-primary" : "text-muted-foreground")}
            aria-hidden="true"
          />
        </span>
        <div className="min-w-0 flex-1">
          <ItemTitle className="w-full min-w-0 text-base leading-snug">
            <span className="block truncate">{title}</span>
          </ItemTitle>
        </div>
      </div>

      <ItemDescription className="mt-1 pl-7 line-clamp-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <CopyableIdBadge id={u.id} Icon={UserIcon} />
          <CopyableIdBadge id={u.email} Icon={Mail} minLength={200} />
        </span>
      </ItemDescription>

      {metaItems.length ? (
        <>
          <InlineItemRow
            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground md:hidden"
            items={metaItems}
          />
          <InlineItemRow
            className="mt-1 hidden flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground md:flex"
            items={metaItems}
          />
        </>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground md:hidden">
        <span className="inline-flex items-center gap-1">
          <Calendar className="size-3.5" aria-hidden="true" />
          {createdRel}
        </span>
        {lastSeenRel ? (
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {lastSeenRel}
          </span>
        ) : null}
      </div>
    </ItemContent>
  )

  const middleColumn = (
    <div className="flex flex-col items-start gap-1 pt-0.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Calendar className="size-3.5" aria-hidden="true" />
        {createdRel}
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock3 className="size-3.5" aria-hidden="true" />
        {lastSeenRel ?? "—"}
      </span>
    </div>
  )

  const actions = (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {props.actions?.copyId ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void props.actions?.copyId?.()
              }}
            >
              <Copy className="size-4" />
              {t("admin.users.actions.copyUserIdAction")}
            </DropdownMenuItem>
          ) : null}

          {props.actions?.kick ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void props.actions?.kick?.()
              }}
            >
              <LogOut className="size-4" />
              {t("admin.users.actions.kickSessionsAction")}
            </DropdownMenuItem>
          ) : null}

          {props.actions?.resetPassword ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  void props.actions?.resetPassword?.()
                }}
              >
                <KeyRound className="size-4" />
                {t("admin.users.actions.createResetLinkAction")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <CommonListItem
      columns={[
        { key: "left", content: leftColumn, showOnMobile: true },
        { key: "middle", content: middleColumn, minWidthPx: 220, collapsePriority: 50 },
      ]}
      actions={actions}
    />
  )
}

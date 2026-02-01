"use client"

import * as React from "react"
import { Copy, MailPlus, MoreHorizontal, RefreshCw, X } from "lucide-react"
import { z } from "zod"

import { useI18n } from "@/components/i18n-provider"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { CommonListItem } from "@/components/common/common-list-item"
import { ItemsList } from "@/components/common/items-list"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageBlocker } from "@/components/ui/page-blocker"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { toast } from "@/lib/client/toast"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { apiFetchJson } from "@/lib/shared/http/api"
import { formatRelativeTimeFromNow } from "@/lib/shared/format/time"
import { tApiError } from "@/lib/shared/i18n/error"

type InviteRow = {
  id: string
  email: string
  createdAt: string
  expiresAt: string
  invitedBy: { publicId: string; email: string } | null
}

const emailSchema = z.string().trim().email()

export function InviteUserSheet(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useI18n()
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const prevOpenRef = React.useRef<boolean>(props.open)

  const [email, setEmail] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [loadingInvites, setLoadingInvites] = React.useState(false)
  const [revokingId, setRevokingId] = React.useState<string | null>(null)
  const [invites, setInvites] = React.useState<InviteRow[]>([])
  const [loaded, setLoaded] = React.useState(false)

  const emailTrim = email.trim()
  const normalizedEmail = emailTrim.toLowerCase()
  const emailValid = emailTrim.length > 0 && emailSchema.safeParse(emailTrim).success

  async function loadInvitesList() {
    setLoadingInvites(true)
    try {
      const res = await apiFetchJson<{ invites?: InviteRow[] }>("/api/admin/users/invites?page=1&pageSize=50", {
        cache: "no-store",
      })
      setInvites(Array.isArray(res.invites) ? (res.invites as InviteRow[]) : [])
      setLoaded(true)
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "admin.users.invite.loadFailed" }))
    } finally {
      setLoadingInvites(false)
    }
  }

  React.useEffect(() => {
    const prev = prevOpenRef.current
    prevOpenRef.current = props.open
    if (!prev && props.open) {
      // On open: always load "pending invites" list (across emails).
      setInvites([])
      setLoaded(false)
      void loadInvitesList()
    }
  }, [props.open])

  async function createInvite() {
    if (!emailValid) {
      toast.error(t("admin.users.invite.emailInvalid"))
      return
    }
    const normalized = normalizedEmail
    setCreating(true)
    try {
      const res = await apiFetchJson<{
        invite?: { id: string; email: string; inviteUrl: string; expiresAt: string }
        emailSent?: boolean
        emailErrorCode?: string | null
      }>("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      })
      if (!res.invite?.inviteUrl) throw new Error("Missing inviteUrl")

      await copyTextToClipboard(String(res.invite.inviteUrl))
      toast.success(t("admin.users.invite.createdCopied"))

      await loadInvitesList()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "admin.users.invite.createFailed" }))
    } finally {
      setCreating(false)
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!inviteId.trim()) return
    setRevokingId(inviteId)
    try {
      const res = await apiFetchJson<{ revokedCount?: number }>("/api/admin/users/invite/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      })
      const n = Number(res.revokedCount ?? 0)
      toast.success(t("admin.users.invite.revokedToast", { count: n }))
      await loadInvitesList()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "admin.users.invite.revokeFailed" }))
    } finally {
      setRevokingId(null)
    }
  }

  const uiPending = creating || !!revokingId
  const canLoad = !uiPending && !loadingInvites
  const canInvite = emailValid && !uiPending

  async function copyInviteLink(inviteId: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    const url = `${origin}/signup?invite=${encodeURIComponent(inviteId)}`
    try {
      await copyTextToClipboard(url)
      toast.success(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (uiPending) return
        props.onOpenChange(open)
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col"
        ref={contentRef}
        aria-busy={uiPending || loadingInvites}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => {
            const root = contentRef.current
            if (!root) return
            const first = (root.querySelector("input:not([disabled])") as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <PageBlocker active={uiPending} />

        <SheetHeader>
          <SheetTitle>{t("admin.users.invite.title")}</SheetTitle>
          <SheetDescription>{t("admin.users.invite.description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4 pt-0 space-y-4">
          <FieldGroup>
            <Field data-invalid={emailTrim && !emailValid ? true : undefined}>
              <FieldLabel htmlFor="admin-invite-email">{t("admin.users.invite.emailLabel")}</FieldLabel>
              <div className="space-y-2">
                <Input
                  id="admin-invite-email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("admin.users.invite.emailPlaceholder")}
                  disabled={uiPending}
                  aria-invalid={emailTrim && !emailValid ? true : undefined}
                />
                <Button
                  className="w-full"
                  size="sm"
                  type="button"
                  onClick={() => void createInvite()}
                  disabled={!canInvite}
                >
                  {creating ? <Spinner className="h-4 w-4" /> : <MailPlus className="h-4 w-4" aria-hidden="true" />}
                  {t("admin.users.invite.sendAction")}
                </Button>
              </div>
              {emailTrim && !emailValid ? (
                <FieldDescription className="text-destructive">{t("admin.users.invite.emailInvalid")}</FieldDescription>
              ) : (
                <FieldDescription>{t("admin.users.invite.hint")}</FieldDescription>
              )}
            </Field>
          </FieldGroup>

          <SectionCard>
            <SectionCardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t("admin.users.invite.pendingTitle")}</div>
                </div>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  className="-mr-2"
                  onClick={() => void loadInvitesList()}
                  disabled={!canLoad}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {t("common.refreshAction")}
                </Button>
              </div>
            </SectionCardHeader>
            <SectionCardBody>
              {loadingInvites ? (
                <div className="divide-y">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={`sk2:${i}`} className="border-b last:border-b-0">
                      <CommonListItemSkeleton withMiddle={false} />
                    </div>
                  ))}
                </div>
              ) : invites.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {loaded ? t("admin.users.invite.none") : t("common.loading")}
                </div>
              ) : (
                <ItemsList<InviteRow>
                  items={invites}
                  getKey={(it) => it.id}
                  className="border-0 rounded-none"
                  renderItem={(it) => (
                    <CommonListItem
                      columns={[
                        {
                          key: "left",
                          showOnMobile: true,
                          content: (
                            <ItemContent className="min-w-0">
                              <ItemTitle className="w-full min-w-0 text-base leading-snug">
                                <span className="block truncate">{it.email}</span>
                              </ItemTitle>
                              <ItemDescription className="mt-1 text-xs">
                                {t("admin.users.invite.expiresIn", {
                                  rel: formatRelativeTimeFromNow(it.expiresAt, { locale }),
                                })}
                              </ItemDescription>
                            </ItemContent>
                          ),
                        },
                      ]}
                      actions={
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={t("common.actions")}
                              disabled={uiPending}
                            >
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={(e) => {
                                void copyInviteLink(it.id)
                              }}
                            >
                              <Copy className="size-4" aria-hidden="true" />
                              {t("admin.users.invite.copyInviteLinkAction")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={(e) => {
                                void revokeInvite(it.id)
                              }}
                            >
                              <X className="size-4" aria-hidden="true" />
                              {t("common.cancelAction")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      }
                    />
                  )}
                />
              )}
            </SectionCardBody>
          </SectionCard>
        </div>

        <SheetFooter className="border-t bg-background">
          <div className="flex flex-col gap-2">
            <SheetClose asChild>
              <Button size="sm" variant="outline" disabled={uiPending}>
                {t("common.cancelAction")}
              </Button>
            </SheetClose>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

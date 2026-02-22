"use client"

import * as React from "react"
import { Check, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { StandardActionDialog } from "@/components/common/standard-action-dialog"
import { ChatHistorySheetSkeleton } from "@/components/workflows/agent/chat-history-sheet-skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/lib/client/toast"
import { formatPublicIdForDisplay } from "@/lib/shared/format/id"
import { formatAbsoluteTime } from "@/lib/shared/format/time"
import type { Locale } from "@/lib/shared/i18n/constants"
import { tApiError } from "@/lib/shared/i18n/error"

export type ChatHistoryItem = {
  id: string
  publicId: string
  title: string
  createdAt: string
  updatedAt: string
}

export function ChatHistorySheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  locale: string
  items: ChatHistoryItem[]
  totalCount?: number
  search: string
  onSearchChange: (next: string) => void
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => Promise<void> | void
  onOpenChat: (chatPublicId: string) => void
  onRenameChat: (chatId: string, title: string) => Promise<void>
  onDeleteChat: (chatId: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingValue, setEditingValue] = React.useState("")
  const [savingId, setSavingId] = React.useState<string | null>(null)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const beginEdit = React.useCallback((item: ChatHistoryItem) => {
    setEditingId(item.id)
    setEditingValue(item.title || "")
  }, [])

  const cancelEdit = React.useCallback(() => {
    setEditingId(null)
    setEditingValue("")
  }, [])

  const saveEdit = React.useCallback(
    async (item: ChatHistoryItem) => {
      const next = editingValue.trim()
      if (!next) {
        toast.error(t("agent.chat.history.nameRequired"))
        return
      }
      setSavingId(item.id)
      try {
        await props.onRenameChat(item.id, next)
        setEditingId(null)
        setEditingValue("")
        toast.success(t("agent.chat.history.renamedToast"))
      } catch (e) {
        toast.error(tApiError({ t, err: e, fallbackKey: "common.updateFailed" }))
      } finally {
        setSavingId(null)
      }
    },
    [editingValue, props, t],
  )

  const confirmDelete = React.useCallback(async () => {
    const id = deletingId
    if (!id) return
    setSavingId(id)
    try {
      await props.onDeleteChat(id)
      setDeletingId(null)
      if (editingId === id) cancelEdit()
      toast.success(t("agent.chat.history.deletedToast"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.deleteActionFailed" }))
    } finally {
      setSavingId(null)
    }
  }, [cancelEdit, deletingId, editingId, props, t])

  return (
    <>
      <StandardActionDialog
        open={Boolean(deletingId)}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null)
        }}
        title={t("agent.chat.history.deleteTitle")}
        description={t("agent.chat.history.deleteDescription")}
        pending={Boolean(savingId)}
        actions={[
          {
            key: "cancel",
            kind: "cancel",
            disabled: Boolean(savingId),
          },
          {
            key: "delete",
            label: savingId ? t("common.deleting") : t("common.deleteAction"),
            variant: "destructive",
            icon: savingId ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />,
            disabled: Boolean(savingId),
            onClick: () => void confirmDelete(),
          },
        ]}
      />

      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl flex flex-col"
          ref={contentRef}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          <SheetHeader>
            <SheetTitle>{t("agent.chat.history.title")}</SheetTitle>
            <SheetDescription>
              {t("agent.chat.history.description", { n: props.totalCount ?? props.items.length })}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-auto px-4 pb-2">
            <div className="sticky top-0 z-10 bg-background pb-2 pt-1">
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <Search aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  value={props.search}
                  onChange={(e) => props.onSearchChange(e.target.value)}
                  placeholder={t("agent.chat.history.searchPlaceholder")}
                  className="h-8 text-sm"
                />
                {props.search.length > 0 && (
                  <InputGroupAddon align="inline-end">
                    <button
                      type="button"
                      className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      onClick={() => props.onSearchChange("")}
                    >
                      <X className="size-4" />
                    </button>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </div>

            {props.loading ? (
              <div className="pt-2">
                <ChatHistorySheetSkeleton rows={6} />
              </div>
            ) : props.items.length === 0 ? (
              <div className="pt-4 text-sm text-muted-foreground">
                {props.search.trim() ? t("agent.chat.history.noSearchResults") : t("agent.chat.history.empty")}
              </div>
            ) : (
              <div className="space-y-2 pt-2">
                {props.items.map((it) => {
                  const isEditing = editingId === it.id
                  const busy = savingId === it.id
                  const title = (it.title || "").trim() || t("agent.chat.newChat")
                  return (
                    <div
                      key={it.id}
                      className={`rounded-lg border bg-card p-3 transition-colors ${isEditing ? "" : "cursor-pointer hover:bg-accent/50"}`}
                      onClick={() => {
                        if (!isEditing && !busy) props.onOpenChat(it.publicId)
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <Input
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              maxLength={120}
                              placeholder={t("agent.chat.history.namePlaceholder")}
                              disabled={busy}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault()
                                  void saveEdit(it)
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault()
                                  cancelEdit()
                                }
                              }}
                            />
                          ) : (
                            <div className="truncate text-sm font-medium">{title}</div>
                          )}
                          <div className="mt-1 text-xs text-muted-foreground">
                            <span className="font-mono">{formatPublicIdForDisplay(it.publicId)}</span>
                            <span> • </span>
                            {formatAbsoluteTime(it.updatedAt, { locale: props.locale as Locale })}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {isEditing ? (
                            <>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => void saveEdit(it)}
                                aria-label={t("common.saveAction")}
                              >
                                {busy ? <Spinner className="size-4" /> : <Check className="size-4" />}
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={cancelEdit}
                                aria-label={t("common.cancelAction")}
                              >
                                <X className="size-4" />
                              </Button>
                            </>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={t("common.actions")}>
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => beginEdit(it)}>
                                  <Pencil className="size-4" />
                                  {t("agent.chat.history.renameAction")}
                                </DropdownMenuItem>
                                <DropdownMenuItem data-variant="destructive" onSelect={() => setDeletingId(it.id)}>
                                  <Trash2 className="size-4" />
                                  {t("common.deleteAction")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <SheetFooter className="border-t bg-background">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void props.onLoadMore()}
              disabled={props.loading || props.loadingMore || !props.hasMore}
              className="w-full sm:w-auto"
            >
              {props.loadingMore ? <Spinner className="h-4 w-4" /> : null}
              <span>{props.loadingMore ? t("common.loading") : t("agent.chat.history.loadMore")}</span>
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

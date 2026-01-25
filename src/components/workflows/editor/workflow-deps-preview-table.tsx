"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/components/i18n-provider"

export type DepsPreviewRow = { name: string; version: string }

export function WorkflowDepsPreviewTable(props: {
  rows: DepsPreviewRow[]
  emptyText?: string
  maxRows?: number
  onShowAll?: () => void
}) {
  const { t } = useI18n()
  const emptyText = props.emptyText ?? t("workflows.deps.empty")
  const maxRows = props.maxRows ?? Number.POSITIVE_INFINITY
  const showAllButton = !!props.onShowAll && props.rows.length > maxRows
  const previewRows = showAllButton ? props.rows.slice(0, maxRows) : props.rows

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">{t("workflows.deps.columns.name")}</TableHead>
            <TableHead className="h-8 w-[50%]">{t("workflows.deps.columns.version")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {previewRows.length ? (
            <>
              {previewRows.map((d) => (
                <TableRow key={d.name}>
                  <TableCell className="font-mono text-xs">{d.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{d.version}</TableCell>
                </TableRow>
              ))}
              {showAllButton ? (
                <TableRow key="__show_all__">
                  <TableCell colSpan={2} className="p-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full h-8 text-xs"
                      onClick={props.onShowAll}
                    >
                      {t("workflows.preview.showAllAction", { n: props.rows.length })}
                    </Button>
                  </TableCell>
                </TableRow>
              ) : null}
            </>
          ) : (
            <TableRow>
              <TableCell colSpan={2} className="py-6 text-center text-xs text-muted-foreground">
                {emptyText}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

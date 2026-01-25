"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/components/i18n-provider"

export type EnvPreviewRow = { key: string; value: string }

export function WorkflowEnvPreviewTable(props: {
  rows: EnvPreviewRow[]
  emptyText?: string
  maxRows?: number
  onShowAll?: () => void
}) {
  const { t } = useI18n()
  const emptyText = props.emptyText ?? t("workflows.env.empty")
  const maxRows = props.maxRows ?? Number.POSITIVE_INFINITY
  const showAllButton = !!props.onShowAll && props.rows.length > maxRows
  const previewRows = showAllButton ? props.rows.slice(0, maxRows) : props.rows

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">{t("workflows.env.columns.key")}</TableHead>
            <TableHead className="h-8 w-[50%]">{t("workflows.env.columns.value")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {previewRows.length ? (
            <>
              {previewRows.map((e) => (
                <TableRow key={e.key}>
                  <TableCell className="font-mono text-xs">{e.key}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{e.value}</TableCell>
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

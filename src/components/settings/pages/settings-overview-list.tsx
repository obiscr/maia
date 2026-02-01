"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { CommonListItem } from "@/components/common/common-list-item"
import { ItemsList } from "@/components/common/items-list"
import { Button } from "@/components/ui/button"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"

export type SettingsOverviewItem = {
  key: string
  title: string
  description: string
  href: string
}

export function SettingsOverviewList(props: { items: SettingsOverviewItem[]; openLabel: string }) {
  return (
    <ItemsList<SettingsOverviewItem>
      items={props.items}
      getKey={(it) => it.key}
      renderItem={(it) => (
        <CommonListItem
          columns={[
            {
              key: "left",
              showOnMobile: true,
              content: (
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full min-w-0 text-base leading-snug">
                    <span className="text-sm block truncate font-medium">{it.title}</span>
                  </ItemTitle>
                  <ItemDescription className="mt-1 line-clamp-2 text-xs">{it.description}</ItemDescription>
                </ItemContent>
              ),
            },
          ]}
          actions={
            <Button asChild size="sm" variant="secondary">
              <Link href={it.href}>
                {props.openLabel}
                <ArrowRight />
              </Link>
            </Button>
          }
        />
      )}
    />
  )
}

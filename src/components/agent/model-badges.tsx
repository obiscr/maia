import * as SelectPrimitive from "@radix-ui/react-select"
import { CheckIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const BADGE_COLORS: Record<string, string> = {
  chat: "bg-zinc-500/20 text-zinc-700 dark:bg-zinc-400/20 dark:text-zinc-300",
  plan: "bg-blue-500/20 text-blue-700 dark:bg-blue-400/20 dark:text-blue-300",
  agent: "bg-violet-500/20 text-violet-700 dark:bg-violet-400/20 dark:text-violet-300",
}

function ModelBadges({ badges }: { badges?: string[] }) {
  if (!badges?.length) return null
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {badges.map((b) => (
        <Badge
          key={b}
          variant="secondary"
          className={cn(
            "h-4 rounded-sm px-1.5 py-0 text-[10px] leading-none border-0",
            BADGE_COLORS[b] ?? "bg-muted text-muted-foreground",
          )}
        >
          {b}
        </Badge>
      ))}
    </span>
  )
}

export function ModelSelectItem({ value, name, badges }: { value: string; name: string; badges?: string[] }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={value}
      className="focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{name}</SelectPrimitive.ItemText>
      <ModelBadges badges={badges} />
    </SelectPrimitive.Item>
  )
}

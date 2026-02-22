"use client"

import * as React from "react"
import { Streamdown, type Components } from "streamdown"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"

import { ChatMarkdown } from "@/components/common/markdown/chat-markdown"
import { cn } from "@/lib/utils"

type Props = {
  markdown: string
  className?: string
}

function splitByLastClosedFence(markdown: string): { stable: string; tail: string } {
  const text = String(markdown ?? "")
  if (!text.trim()) return { stable: "", tail: text }

  const lines = text.split("\n")
  let inFence = false
  let fenceChar = ""
  let fenceLen = 0
  let sawAnyFence = false
  let lastClosedFenceLine = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const m = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (!m) continue
    const marker = m[1] ?? ""
    const char = marker[0] ?? ""
    const len = marker.length
    if (!inFence) {
      inFence = true
      fenceChar = char
      fenceLen = len
      sawAnyFence = true
      continue
    }
    if (char === fenceChar && len >= fenceLen) {
      inFence = false
      lastClosedFenceLine = i
    }
  }

  if (!sawAnyFence || lastClosedFenceLine < 0) {
    return { stable: "", tail: text }
  }

  const stable = lines.slice(0, lastClosedFenceLine + 1).join("\n")
  const tail = lines.slice(lastClosedFenceLine + 1).join("\n")
  return { stable, tail }
}

const streamdownComponents: Components = {
  p: ({ children, node: _node, ...rest }) => <p {...rest}>{children}</p>,
  ul: ({ children, node: _node, ...rest }) => <ul {...rest}>{children}</ul>,
  ol: ({ children, node: _node, ...rest }) => <ol {...rest}>{children}</ol>,
  li: ({ children, node: _node, ...rest }) => <li {...rest}>{children}</li>,
  h1: ({ children, node: _node, ...rest }) => <h1 {...rest}>{children}</h1>,
  h2: ({ children, node: _node, ...rest }) => <h2 {...rest}>{children}</h2>,
  h3: ({ children, node: _node, ...rest }) => <h3 {...rest}>{children}</h3>,
  h4: ({ children, node: _node, ...rest }) => <h4 {...rest}>{children}</h4>,
  h5: ({ children, node: _node, ...rest }) => <h5 {...rest}>{children}</h5>,
  h6: ({ children, node: _node, ...rest }) => <h6 {...rest}>{children}</h6>,
  blockquote: ({ children, node: _node, ...rest }) => <blockquote {...rest}>{children}</blockquote>,
  hr: ({ node: _node, ...rest }) => <hr {...rest} />,
  strong: ({ children, node: _node, ...rest }) => <strong {...rest}>{children}</strong>,
  em: ({ children, node: _node, ...rest }) => <em {...rest}>{children}</em>,
  a: ({ href, children, node: _node, ...rest }) => {
    const raw = String(href ?? "")
    const safeHref = /^\s*javascript:/i.test(raw) ? "#" : raw
    return (
      <a href={safeHref} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    )
  },
  table: ({ children, node: _node, ...rest }) => (
    <div className="maia-table-scroll">
      <table {...rest}>{children}</table>
    </div>
  ),
  thead: ({ children, node: _node, ...rest }) => <thead {...rest}>{children}</thead>,
  tbody: ({ children, node: _node, ...rest }) => <tbody {...rest}>{children}</tbody>,
  tr: ({ children, node: _node, ...rest }) => <tr {...rest}>{children}</tr>,
  th: ({ children, node: _node, ...rest }) => <th {...rest}>{children}</th>,
  td: ({ children, node: _node, ...rest }) => <td {...rest}>{children}</td>,
  code: ({ children, node: _node, ...rest }) => <code {...rest}>{children}</code>,
  pre: ({ children, node: _node, ...rest }) => <pre {...rest}>{children}</pre>,
  img: ({ node: _node, alt, ...rest }) => <img alt={alt ?? ""} {...rest} />,
  sup: ({ children, node: _node, ...rest }) => <sup {...rest}>{children}</sup>,
  sub: ({ children, node: _node, ...rest }) => <sub {...rest}>{children}</sub>,
  section: ({ children, node: _node, ...rest }) => <section {...rest}>{children}</section>,
}

export function ChatStreamdown(props: Props) {
  const { stable, tail } = React.useMemo(() => splitByLastClosedFence(props.markdown), [props.markdown])

  return (
    <div className={cn("space-y-0", props.className)}>
      {stable ? <ChatMarkdown markdown={stable} className="maia-mdx" /> : null}
      {tail ? (
        <Streamdown
          className="maia-mdx space-y-0"
          mode="streaming"
          isAnimating={false}
          animated={false}
          parseIncompleteMarkdown={true}
          components={streamdownComponents}
          plugins={{ math, mermaid }}
          controls={{
            code: false,
            table: true,
            mermaid: false,
          }}
          remend={{ linkMode: "text-only" }}
        >
          {tail}
        </Streamdown>
      ) : null}
    </div>
  )
}

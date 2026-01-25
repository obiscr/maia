import * as React from "react"

export function GradientLoaderIcon(props: { className?: string }) {
  const gradId = React.useId()
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={props.className}
      fill="none"
      stroke={`url(#${gradId})`}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="24" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#d946ef" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      {/* Loader2-like arc */}
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

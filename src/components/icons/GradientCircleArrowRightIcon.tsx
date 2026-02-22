import * as React from "react"

export function GradientCircleArrowRightIcon(props: React.ComponentPropsWithoutRef<"svg">) {
  const gradId = React.useId()
  const { className, ...rest } = props
  return (
    <svg
      {...rest}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16l4-4-4-4" />
      <path d="M8 12h8" />
    </svg>
  )
}

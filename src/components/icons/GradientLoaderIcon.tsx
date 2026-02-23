import * as React from "react"

const GRADIENT_STYLE: React.CSSProperties = {
  borderRadius: "50%",
  background:
    "conic-gradient(transparent 0deg 30deg, #d946ef 60deg, #8b5cf6 180deg, #06b6d4 330deg, transparent 360deg)",
  WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
  mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
}

/**
 * Gradient arc spinner using pure CSS (conic-gradient + mask).
 * Unlike an SVG-based approach, a plain div with transform animation is
 * reliably promoted to a GPU compositor layer, so the spin stays smooth
 * even when the main thread is busy with streaming React updates.
 */
export function GradientLoaderIcon(props: React.ComponentPropsWithoutRef<"div">) {
  const { className, style, ...rest } = props
  return (
    <div
      aria-hidden="true"
      {...rest}
      className={className}
      style={style ? { ...GRADIENT_STYLE, ...style } : GRADIENT_STYLE}
    />
  )
}

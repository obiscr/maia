import * as React from "react"

const MOBILE_BREAKPOINT = 768

function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => {
      setMatches(mql.matches)
    }
    mql.addEventListener("change", onChange)
    setMatches(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return !!matches
}

/**
 * Returns true when the viewport width is strictly less than the given breakpoint.
 * Example: breakpoint=1024 -> true for <= 1023px.
 */
export function useIsBelowBreakpoint(breakpoint: number) {
  const query = `(max-width: ${breakpoint - 1}px)`
  return useMediaQuery(query)
}

export function useIsMobile() {
  return useIsBelowBreakpoint(MOBILE_BREAKPOINT)
}

import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Subscribe to viewport width via useSyncExternalStore so we never
// `setState` inside an effect (which trips
// react-hooks/set-state-in-effect). The browser MediaQueryList is
// the external store; React reads the live snapshot on every
// render that's triggered by an MQL change.
function subscribe(notify: () => void) {
  if (typeof window === "undefined") return () => {}
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", notify)
  return () => mql.removeEventListener("change", notify)
}

function getSnapshot(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT
}

// SSR snapshot — render desktop-style during the server pass and
// the first hydration pass; the client effect then notifies if the
// viewport is actually mobile. Matches the previous behaviour
// where `useIsMobile()` returned `false` until the effect ran.
function getServerSnapshot(): boolean {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )
}

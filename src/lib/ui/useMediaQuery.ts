// useMediaQuery — tiny matchMedia hook used by Layout.tsx to pick between
// the desktop sticky <aside> and the mobile <KanaDrawer/> (DESIGN.md §2.1).
// This app is client-rendered only (no SSR), so the lazy useState initializer
// below reads matchMedia synchronously on first render in a real browser --
// there's no hydration mismatch to worry about. The `typeof window`/
// `matchMedia` guards exist only for environments that have neither
// (vitest's default "node" test environment -- DESIGN.md §4 "vitest 環境是
// node，未裝 jsdom"), where the hook must degrade to a stable `false`
// instead of throwing.

import { useEffect, useState } from "react";

function readMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatches(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(query);
    const listener = () => setMatches(mql.matches);
    // The query string itself may have changed since the lazy initializer
    // ran (a fresh `query` on re-render isn't re-read by useState), so sync
    // once eagerly before subscribing.
    listener();
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

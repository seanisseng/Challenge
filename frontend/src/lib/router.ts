/**
 * Minimal history-API router.
 *
 * The app has exactly two entry points — the player join flow at `/` and the
 * host console at `/admin` — so pulling in a router library would be more
 * machinery than the problem needs.
 */

import { useEffect, useState } from "react";

export function useRoute(): string {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return path;
}

export function navigate(to: string): void {
  if (window.location.pathname === to) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

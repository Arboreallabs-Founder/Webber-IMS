"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

const NAV_START_EVENT = "webber:nav-start";

/**
 * Kicks off the top progress bar for a navigation the bar can't detect on its
 * own — i.e. `router.push()` / `router.replace()` from a client component after
 * a server action. Link clicks and browser back/forward are picked up
 * automatically by the listeners in `NavigationProgress`.
 */
export function startNavProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAV_START_EVENT));
}

/**
 * Thin indeterminate bar across the top of the viewport, shown from the moment
 * a navigation is requested until the new route commits.
 *
 * App Router gives no public router-events API, so navigation *starts* are
 * detected from the DOM (anchor clicks + popstate) and explicit
 * `startNavProgress()` calls; the *end* is a `usePathname()` change. A watchdog
 * clears the bar if a navigation is cancelled or the pathname never changes, so
 * it can never get stuck on screen.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = React.useState(0);
  const [visible, setVisible] = React.useState(false);

  const rampRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const hideRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = React.useCallback(() => {
    if (rampRef.current) clearInterval(rampRef.current);
    if (hideRef.current) clearTimeout(hideRef.current);
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    rampRef.current = null;
    hideRef.current = null;
    watchdogRef.current = null;
  }, []);

  const finish = React.useCallback(() => {
    clearTimers();
    setProgress(100);
    hideRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 220);
  }, [clearTimers]);

  const start = React.useCallback(() => {
    clearTimers();
    setVisible(true);
    setProgress(8);
    // Ease toward 90% and wait there — the last 10% lands when the route commits.
    rampRef.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + Math.max(0.5, (90 - p) * 0.08)));
    }, 120);
    // Never leave the bar on screen if the navigation is cancelled or blocked.
    watchdogRef.current = setTimeout(finish, 10000);
  }, [clearTimers, finish]);

  // Navigation finished (or the user landed somewhere new) — drop the bar.
  React.useEffect(() => {
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  React.useEffect(() => {
    function onNavStart() {
      start();
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // External links, and in-page anchors, are not route changes.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      start();
    }

    window.addEventListener(NAV_START_EVENT, onNavStart);
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", onNavStart);
    return () => {
      window.removeEventListener(NAV_START_EVENT, onNavStart);
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", onNavStart);
      clearTimers();
    };
  }, [start, clearTimers]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 print:hidden"
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--primary)] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }}
      />
    </div>
  );
}

/**
 * Tracks whether the "video-overlay" window's page is actually live (its
 * command listeners registered). The overlay page pings
 * `video-overlay-ready` once it can receive popup commands; main.ts marks it
 * here, and videoViewer gates `setPopupMode("overlay")` on it — if the
 * overlay page failed to load for any reason, the player keeps the proven
 * bar-internal popup instead of a popup that goes nowhere.
 */

let ready = false;
const waiters: Array<(wasReady: boolean) => void> = [];

/** Called by main.ts when the overlay page reports readiness. */
export function markOverlayReady(): void {
  if (ready) return;
  ready = true;
  for (const resolve of waiters.splice(0)) resolve(true);
}

export function isOverlayReady(): boolean {
  return ready;
}

/** Resolve `true` as soon as the overlay page is live, or `false` after the timeout. */
export function waitForOverlayReady(timeoutMs: number): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      const index = waiters.indexOf(resolve);
      if (index >= 0) waiters.splice(index, 1);
      resolve(false);
    }, timeoutMs);
    waiters.push((wasReady) => {
      window.clearTimeout(timer);
      resolve(wasReady);
    });
  });
}

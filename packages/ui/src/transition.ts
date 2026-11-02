/** Runs a UI update inside a View Transition (shared-element morph) when the browser has them. */
export function withTransition(update: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (callback: () => Promise<void> | void) => unknown;
  };
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduced) {
    update();
    return;
  }
  doc.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        update();
        // Preact renders asynchronously: wait until the new screen is in the DOM.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

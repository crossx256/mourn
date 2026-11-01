/**
 * Registry for the Android system back gesture.
 *
 * `boot/androidBack.ts` owns the `backButton` listener (Capacitor stops applying
 * its own default as soon as one exists), and asks this registry first. Surfaces
 * push a handler for the top-most transient UI they own — an open conversation,
 * an open drawer — and the newest registration wins, so nested surfaces unwind in
 * the order a user expects. A handler returns `true` when it consumed the press.
 *
 * Kept as a plain module-level array (not a store): it holds no reactive state,
 * and it must be usable from any component without prop drilling.
 */

export type MobileBackHandler = () => boolean;

const handlers: MobileBackHandler[] = [];

/** Register a back handler; call the returned function to unregister. */
export function registerMobileBackHandler(handler: MobileBackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
  };
}

/** Offer the press to the most recently registered handler. `true` = consumed. */
export function handleMobileBack(): boolean {
  for (let index = handlers.length - 1; index >= 0; index -= 1) {
    const handler = handlers[index];
    if (!handler) continue;
    try {
      if (handler()) return true;
    } catch (error) {
      // A broken handler must never swallow the back gesture.
      console.warn('[Back] handler failed', error);
    }
  }
  return false;
}

/** Test seam. */
export function clearMobileBackHandlers(): void {
  handlers.length = 0;
}

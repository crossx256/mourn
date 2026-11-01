/**
 * useDismissable — per-surface "do not show again" persistence.
 *
 * Stores a boolean dismissal flag in localStorage under a stable, namespaced key
 * so an offline alert (messaging / dashboard) the user chooses to never see again
 * stays dismissed across launches. Reading never throws; `reset()` lets tests or
 * a settings surface clear the flag.
 */
const PREFIX = 'mourn:dismiss:';

export function dismissKey(surface: string): string {
  return `${PREFIX}${surface.toLowerCase()}`;
}

export function isDismissed(surface: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(dismissKey(surface)) === '1';
  } catch {
    return false;
  }
}

export function dismissForever(surface: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(dismissKey(surface), '1');
  } catch {
    // Ignore storage write failures (private browsing / quota).
  }
}

export function resetDismissed(surface: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(dismissKey(surface));
  } catch {
    // Ignore.
  }
}

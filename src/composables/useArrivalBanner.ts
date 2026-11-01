import { reactive } from 'vue';

/**
 * Transient in-app arrival banner, Discord-style.
 *
 * A message that lands while Mourn is in front of the user used to be a plain
 * Quasar toast. This is the richer surface: the sender, the decrypted message text,
 * and a progress bar that drains right-to-left and takes the banner away with it.
 *
 * Module-level singleton state (not a Pinia store) because the trigger is a service
 * (`mobilePush`) rather than a component, and exactly one banner can be on screen.
 */
export interface ArrivalBannerPayload {
  /** Stable arrival identity — showing the same arrival twice replaces, never stacks. */
  id: string;
  /** Sender display name (falls back to the app name for non-message events). */
  title: string;
  /** Decrypted message text, already truncated by the caller. */
  body: string;
  linkId?: string | null;
  groupId?: string | null;
  avatarUrl?: string | null;
  /** How long the banner stays up; the progress bar is driven by the same value. */
  durationMs?: number;
}

export const DEFAULT_ARRIVAL_BANNER_MS = 5000;

type ActiveBanner = ArrivalBannerPayload & { durationMs: number };

const state = reactive<{ current: ActiveBanner | null }>({ current: null });
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

export function showArrivalBanner(payload: ArrivalBannerPayload): void {
  if (!payload?.id) return;

  clearTimer();
  const durationMs = payload.durationMs && payload.durationMs > 0
    ? payload.durationMs
    : DEFAULT_ARRIVAL_BANNER_MS;

  state.current = { ...payload, durationMs };

  // The component also listens for the progress bar's animationend, so the banner
  // still leaves on time if a throttled timer fires late.
  dismissTimer = setTimeout(() => dismissArrivalBanner(payload.id), durationMs);
}

export function dismissArrivalBanner(id?: string): void {
  if (!state.current) return;
  // Ignore a stale dismissal from a banner that has already been replaced.
  if (id && state.current.id !== id) return;
  clearTimer();
  state.current = null;
}

export function useArrivalBanner() {
  return {
    banner: state,
    showArrivalBanner,
    dismissArrivalBanner,
  };
}

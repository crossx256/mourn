// =============================================
// useMessaging — Composable bridging frontend ↔ Rust
// =============================================
// On Desktop (Tauri): routes operations through Rust commands
// for local encryption key management and expiry notifications.
// On Web: falls back to pure API-driven flow.

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useNativeShell } from './useNativeShell';
import { useLinksStore } from 'stores/links';
import type { Link } from 'src/types/links';

export function useMessaging() {
  const { isTauri } = useNativeShell();
  const linksStore = useLinksStore();

  const isReady = ref(false);
  const error = ref<string | null>(null);

  onMounted(async () => {
    // Initial fetch of all links
    await linksStore.fetchLinks();
    isReady.value = true;

    // SECURITY: Disabled polling - creates observable timing patterns
    // Polling every 30s leaks to network observer that user is active
    // Use SSE/WebSocket for real-time updates instead
    // (polling intentionally not implemented)
  });

  onUnmounted(() => {
    // Polling disabled - no cleanup needed
  });

  // ───── Tauri bridge helpers ─────

  async function tauriInvoke<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T | null> {
    if (!isTauri.value || !window.__TAURI_INTERNALS__) return null;
    try {
      // Dynamic import — @tauri-apps/api only exists in desktop builds
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import('@tauri-apps/api/core' as any)) as {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
      return (await mod.invoke(command, args)) as T;
    } catch (err) {
      console.error(`[useMessaging] Tauri invoke "${command}" failed:`, err);
      error.value = String(err);
      return null;
    }
  }

  // ───── Public API ─────

  /**
   * Establish a secure link. On desktop, generates a local encryption key.
   */
  async function establishLink(receiverId: string, anchor = false) {
    error.value = null;

    // Desktop: create local key via Rust before API call
    if (isTauri.value) {
      await tauriInvoke('establish_secure_link', { chatId: receiverId, anchor });
    }

    return linksStore.requestLink(receiverId, anchor);
  }

  /**
   * Anchor a link permanently. On desktop, updates local key storage.
   */
  async function anchorLink(linkId: string) {
    error.value = null;

    if (isTauri.value) {
      await tauriInvoke('anchor_link', { chatId: linkId });
    }

    return linksStore.anchorLink(linkId);
  }

  /**
   * Get the time remaining for an ESTABLISHED link.
   * On desktop, queries the Rust layer for precision; on web, computes locally.
   */
  async function getLinkExpiry(link: Link): Promise<number> {
    // No expiry (anchored) is decided here, before the desktop bridge: the Rust
    // command answers -1 for "none", and returning it unchanged gave callers a
    // negative "milliseconds remaining" alongside Infinity on web.
    if (!link.expiresAt) return Infinity;

    if (isTauri.value) {
      const result = await tauriInvoke<{ ms_remaining: number }>('get_link_expiry', {
        expiresAt: link.expiresAt,
      });
      if (result && Number.isFinite(result.ms_remaining) && result.ms_remaining >= 0) {
        return result.ms_remaining;
      }
      // Bridge unavailable or unparsable: fall through to the local computation
      // rather than silently reusing a stale/absent answer.
    }

    const remaining = new Date(link.expiresAt).getTime() - Date.now();
    return Number.isFinite(remaining) ? Math.max(0, remaining) : Infinity;
  }

  /**
   * Check if a link has expired
   */
  function isExpired(link: Link): boolean {
    if (link.status === 'ANCHORED') return false;
    if (!link.expiresAt) return false;
    return Date.now() > new Date(link.expiresAt).getTime();
  }

  /**
   * Check if a link is in the "urgent" zone (<6h remaining)
   */
  function isUrgent(link: Link): boolean {
    if (!link.expiresAt) return false;
    const remaining = new Date(link.expiresAt).getTime() - Date.now();
    return remaining > 0 && remaining < 6 * 60 * 60 * 1000;
  }

  return {
    // State
    isReady,
    error,
    isTauri,
    links: computed(() => linksStore.links),
    activeChains: computed(() => linksStore.activeChains),
    anchoredLinks: computed(() => linksStore.anchoredLinks),
    decayingLinks: computed(() => linksStore.decayingLinks),
    incomingRequests: computed(() => linksStore.incomingRequests),

    // Actions
    establishLink,
    anchorLink,
    getLinkExpiry,
    isExpired,
    isUrgent,
    fetchLinks: () => linksStore.fetchLinks(),
    respondToLink: (linkId: string, action: 'accept' | 'reject') =>
      linksStore.respondToLink(linkId, action),
  };
}

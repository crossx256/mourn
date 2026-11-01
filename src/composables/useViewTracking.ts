/**
 * useViewTracking — records a profile view via POST /api/v1/view/:username.
 *
 * The backend view-tracking endpoint requires an HMAC-signed view token
 * (X-View-Token header) that is computed server-side. Since the SPA cannot
 * derive the HMAC secret, we embed the token in the public-profile API
 * response (see profiles.routes.js patch) and forward it here.
 *
 * Guards:
 *  - Only fires on the client (SSR-safe).
 *  - Only fires once per profile per page session.
 *  - Silently ignores errors — view tracking is non-critical.
 */
import { ref } from 'vue';
import { api } from 'boot/axios';

const tracked = ref<Set<string>>(new Set());

export function useViewTracking() {
  /**
   * Record a profile view.
   *
   * @param username  The profile's username (lowercase).
   * @param viewToken Optional HMAC view token from the profile API response.
   */
  async function trackView(username: string, viewToken?: string | null) {
    // SSR guard
    if (typeof window === 'undefined') return;

    // Only track once per SPA session per username
    const key = username.toLowerCase();
    if (tracked.value.has(key)) return;
    tracked.value.add(key);

    try {
      const headers: Record<string, string> = {};
      if (viewToken) {
        headers['x-view-token'] = viewToken;
      }

      await api.post(`/api/v1/view/${encodeURIComponent(key)}`, null, { headers });
    } catch {
      // View tracking is best-effort — never interrupt UX
    }
  }

  return { trackView };
}

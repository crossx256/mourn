import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import type { Letter, GraveyardState, GraveyardStatus } from 'src/types/graveyard';
import { useAuthStore } from './auth';
import {
  storeOfflineBlob,
  readOfflineBlob,
  loadOfflineBlob,
  isOfflineVaultEnabled,
  isOfflineModeAuthorized,
} from 'src/crypto/offlineVault';
import { encodeGraveyardPayload, decodeGraveyardPayload } from 'src/utils/offlineGraveyardCodec';

/** Offline vault id used for the whole approved-letters galaxy cache. */
const OFFLINE_GRAVEYARD_ID = 'approved_letters';

/** Content fingerprint of a serialized galaxy so the client can detect staleness. */
async function lettersPayloadSig(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fall back to a length-based marker if WebCrypto is unavailable.
    }
  }
  return `len:${bytes.length}`;
}

const COOLDOWN_DAYS = 14;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const useGraveyardStore = defineStore('graveyard', {
  state: (): GraveyardState & {
    submitting: boolean;
    hasFetched: boolean;
    lastFetchedAt: number | null;
    cacheTtlMs: number;
    progress: number;
    ritualRequested: boolean;
    /** True when the last render served approved letters from the offline vault. */
    offline: boolean;
  } => ({
    letters: [] as Letter[],
    loading: false,
    submitting: false,
    status: null,
    hasFetched: false,
    lastFetchedAt: null,
    cacheTtlMs: 1000 * 60 * 3,
    progress: 0,
    ritualRequested: false,
    offline: false,
  }),

  getters: {
    approvedLetters: (state) => state.letters.filter((l) => l.status === 'APPROVED'),

    /** Remaining time in milliseconds */
    remainingMs(): number {
      if (!this.status?.lastAttempt) return 0;
      const last = new Date(this.status.lastAttempt).getTime();
      const cooldownMs = (this.status.cooldownDays || COOLDOWN_DAYS) * MS_PER_DAY;
      const nextAvailable = last + cooldownMs;
      const now = Date.now();
      return Math.max(0, nextAvailable - now);
    },

    /** Remaining days (for backwards compatibility) */
    cooldownRemaining(): number {
      return Math.ceil(this.remainingMs / MS_PER_DAY);
    },

    /** Remaining time formatted as "Xd Yh" or "Xh Ym" */
    cooldownFormatted(): string {
      const ms = this.remainingMs;
      if (ms === 0) return '';

      const days = Math.floor(ms / MS_PER_DAY);
      const hours = Math.floor((ms % MS_PER_DAY) / (1000 * 60 * 60));
      const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        return `${days}d ${hours}h`;
      }
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    },

    canSubmit(): boolean {
      return this.remainingMs === 0;
    },

    /** True once letters have been fetched at least once */
    isReady: (state) => state.hasFetched && !state.loading,

    isFresh(state): boolean {
      if (!state.lastFetchedAt) return false;
      return Date.now() - state.lastFetchedAt < state.cacheTtlMs;
    },

    shouldShowRitual(): boolean {
      if (this.ritualRequested) return true;
      if (!this.hasFetched) return true;
      return !this.isFresh;
    },
  },

  actions: {
    async fetchStatus() {
      try {
        const { data } = await api.get<GraveyardStatus>('/api/v1/graveyard/status');
        this.status = data;
      } catch (err) {
        console.error('[graveyard] status fetch failed:', err);
        // Default to allowing submit if backend fails
        this.status = {
          lastAttempt: null,
          cooldownDays: COOLDOWN_DAYS,
          canSubmit: true,
          remainingMs: 0,
        };
      }
    },

    async fetchLetters(options?: { force?: boolean }) {
      const force = options?.force ?? false;
      if (!force && this.hasFetched && this.isFresh) {
        this.progress = 100;
        return;
      }
      if (this.loading) return;
      this.loading = true;
      this.progress = 0;

      // Fetch both letters and status in parallel
      await this.fetchStatus();

      try {
        const { data } = await api.get<Letter[]>('/api/v1/graveyard/', {
          onDownloadProgress: (evt) => {
            if (evt.total) {
              this.progress = Math.round((evt.loaded / evt.total) * 100);
            } else {
              this.progress = Math.min(90, this.progress + 5);
            }
          },
        });
        // Backend doesn't return alias — fill with default
        const incoming = data.map((l) => ({
          ...l,
          alias: l.alias || 'Anonymous',
        }));
        if (incoming.length > 0) {
          this.letters = incoming;
        }
        this.offline = false;

        // Cache the approved galaxy so it can be rendered offline (desktop only).
        if (incoming.length > 0 && isOfflineVaultEnabled()) {
          try {
            const payload = encodeGraveyardPayload(incoming);
            await storeOfflineBlob('graveyard', OFFLINE_GRAVEYARD_ID, payload, {
              savedAt: String(Date.now()),
              count: String(incoming.length),
              sig: await lettersPayloadSig(payload),
            });
          } catch (offErr) {
            if (import.meta.env.DEV) {
              console.warn('[graveyard] offline cache failed', offErr);
            }
          }
        }
      } catch (err) {
        // A network failure → fall back to the encrypted offline galaxy so the
        // user can still wander the approved letters offline (desktop only +
        // authorized: desktop + authenticated on this device + stay-logged-in).
        if (this.letters.length === 0 && isOfflineVaultEnabled()) {
          const authed = await isOfflineModeAuthorized();
          if (authed.authorized) {
            try {
              const bytes = await readOfflineBlob('graveyard', OFFLINE_GRAVEYARD_ID);
              if (bytes) {
                const cached = decodeGraveyardPayload(bytes);
                if (cached.length > 0) {
                  this.letters = cached;
                  this.offline = true;
                  this.hasFetched = true;
                  this.lastFetchedAt = Date.now();
                  this.progress = 100;
                  return;
                }
              }
            } catch (offErr) {
              if (import.meta.env.DEV) {
                console.warn('[graveyard] offline hydrate failed', offErr);
              }
            }
          }
        }
        console.error('[graveyard] fetch failed:', err);
      } finally {
        this.loading = false;
        this.hasFetched = true;
        this.lastFetchedAt = Date.now();
        this.progress = 100;
      }
    },

    requestRitual() {
      this.ritualRequested = true;
    },

    clearRitualRequest() {
      this.ritualRequested = false;
    },

    async submitLetter(payload: {
      content: string;
      alias: string;
      mentionId?: string;
    }): Promise<{ success: boolean; error?: string }> {
      // Always fetch fresh status before checking canSubmit to avoid stale data
      await this.fetchStatus();

      if (!this.canSubmit) {
        return {
          success: false,
          error: `you must wait ${this.cooldownFormatted} before posting again.`,
        };
      }

      this.submitting = true;
      try {
        // Fetch CSRF token before submitting
        const authStore = useAuthStore();
        await authStore.fetchCsrfToken();

        await api.post<Letter>('/api/v1/graveyard/', payload, {
          headers: { 'X-CSRF-Token': authStore.csrfToken },
        });
        // Do NOT push the pending letter into the letters array — it won't
        // appear in the scene anyway (only APPROVED letters are shown) and
        // pushing a letter without valid spatial coordinates causes the 3D
        // scene to crash on geometry rebuild.
        await this.fetchStatus();
        return { success: true };
      } catch (err: unknown) {
        console.error('[graveyard] submit failed:', err);
        // Refresh status after failed submit to ensure cooldown is accurate
        await this.fetchStatus();

        if (err && typeof err === 'object' && 'response' in err) {
          const axiosErr = err as { response?: { data?: { error?: string; message?: string } } };
          // Use error message from backend if available (includes cooldown info)
          const backendError = axiosErr.response?.data?.error || axiosErr.response?.data?.message;
          return {
            success: false,
            error: backendError || 'submission failed.',
          };
        }
        return { success: false, error: 'submission failed.' };
      } finally {
        this.submitting = false;
      }
    },

    // ─── Offline galaxy: report whether a download exists and is current ───
    // Compares a fingerprint of the currently-loaded approved letters against
    // the fingerprint stored when the galaxy was last cached. desktop only.
    async getGalaxyOfflineState(): Promise<{
      downloaded: boolean;
      synced: boolean;
      stale: boolean;
    }> {
      if (!isOfflineVaultEnabled()) {
        return { downloaded: false, synced: false, stale: false };
      }
      try {
        const blob = await loadOfflineBlob('graveyard', OFFLINE_GRAVEYARD_ID);
        if (!blob) {
          return { downloaded: false, synced: false, stale: false };
        }
        const currentSig = await lettersPayloadSig(encodeGraveyardPayload(this.approvedLetters));
        const storedSig = blob.meta?.sig ?? '';
        const storedCount = Number(blob.meta?.count ?? 0);
        const currentCount = this.approvedLetters.length;
        const synced = currentCount > 0 && storedCount === currentCount && storedSig === currentSig;
        return { downloaded: true, synced, stale: !synced };
      } catch {
        return { downloaded: false, synced: false, stale: false };
      }
    },

    // ─── Offline galaxy: force-recache the currently-loaded approved letters ───
    async syncGalaxyOffline(): Promise<boolean> {
      if (!isOfflineVaultEnabled() || this.approvedLetters.length === 0) {
        return false;
      }
      try {
        const payload = encodeGraveyardPayload(this.approvedLetters);
        await storeOfflineBlob('graveyard', OFFLINE_GRAVEYARD_ID, payload, {
          savedAt: String(Date.now()),
          count: String(this.approvedLetters.length),
          sig: await lettersPayloadSig(payload),
        });
        return true;
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[graveyard] offline galaxy sync failed', err);
        }
        return false;
      }
    },
  },
});

import { defineStore } from 'pinia';
import { api, resolveApiUrl } from 'src/boot/axios';
import type { Announcement } from 'src/types/system';

/**
 * Pinia store: useAnnouncementsStore
 *
 * Manages real-time announcements via Server-Sent Events (SSE).
 * Falls back gracefully if EventSource is unavailable (SSR, old browsers).
 *
 * Backend contract (from legacy mourn.bio):
 *   GET  /api/announcements          → { announcements: Announcement[] }
 *   GET  /api/announcements/stream   → SSE stream
 *        event: announcement          → new announcement payload
 *        event: refresh               → signal to re-fetch list
 */

const SSE_PATH = '/api/v1/public/announcements/stream';
const REST_PATH = '/api/v1/public/announcements';
const EVENT_SOURCE_CLOSED = 2;

/**
 * Whether the native EventSource has STOPPED retrying this stream.
 *
 * `2` is `EventSource.CLOSED` — the element (or a `close()` call) has ended the
 * connection for good. `1` (OPEN) is live, and `0` (CONNECTING) is where the
 * browser sits while it performs its OWN retry, so the app must not step in for
 * either of those.
 */
function nativeRetryGivenUp(source: EventSource): boolean {
  return (source as { readyState?: number }).readyState === EVENT_SOURCE_CLOSED;
}

export const useAnnouncementsStore = defineStore('announcements', {
  state: () => ({
    /** All active announcements, newest first. */
    items: [] as Announcement[],
    /** Whether the initial fetch has completed. */
    loaded: false,
    /** Whether the SSE connection is live. */
    connected: false,
    /** Last error message, if any. */
    error: null as string | null,
  }),

  getters: {
    /**
     * Only active announcements.
     *
     * Defensive `Array.isArray`: a malformed/renamed backend payload used to be
     * assigned straight into `items`, and one object-shaped payload made this
     * getter throw inside the landing page's render function — which blanked the
     * whole index page instead of degrading to the REST list.
     */
    active: (state): Announcement[] =>
      (Array.isArray(state.items) ? state.items : []).filter((a) => a.isActive),

    /** Most recent active announcement (for hero / featured display). */
    latest(): Announcement | null {
      return this.active.length > 0 ? (this.active[0] as Announcement) : null;
    },
  },

  actions: {
    /* ==============================================================
       REST — initial & fallback fetch
       ============================================================== */
    async fetchAnnouncements() {
      try {
        const { data } = await api.get(REST_PATH);
        // The backend has shipped both `{ data: [...] }` and
        // `{ data: { data: [...] } }`; accept either instead of trusting one.
        const raw = data?.data ?? data?.announcements ?? data ?? [];
        const list = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.data)
            ? raw.data
            : Array.isArray(raw?.announcements)
              ? raw.announcements
              : [];
        this.items = list as Announcement[];
        this.loaded = true;
        this.error = null;
      } catch (err) {
        console.error('[announcements] fetch failed:', err);
        this.error = 'Failed to load announcements';
      }
    },

    /* ==============================================================
       SSE — real-time connection
       ============================================================== */
    _eventSource: null as EventSource | null,
    _onlineListener: null as (() => void) | null,
    _visibilityListener: null as (() => void) | null,

    /**
     * Open an SSE connection to the backend announcements stream.
     *
     * Reconnect ownership: a native EventSource retries a dropped transport on
     * its own (it re-dials the same URL after `onerror`). This store used to
     * also close the stream and arm its own back-off timer from `onerror`, so a
     * single blip produced TWO reconnects and a background wake-up on mobile the
     * native retry had already made redundant. The native retry owns the
     * transport now; the app only re-opens a stream the element has given up on
     * (state CLOSED), or when the document becomes visible again with no live
     * stream — a backgrounded mobile WebView kills the connection silently.
     */
    connectSSE() {
      // Guard: SSR or missing API
      if (typeof window === 'undefined' || !('EventSource' in window)) return;

      if (!navigator.onLine) {
        this.followOnline();
        return;
      }

      // Prevent duplicate connections — but replace a stream the native retry
      // has already abandoned instead of treating it as still live.
      if (this._eventSource) {
        if (!nativeRetryGivenUp(this._eventSource)) return;
        this._eventSource.close();
        this._eventSource = null;
      }

      const url = resolveApiUrl(SSE_PATH);

      const es = new EventSource(url, { withCredentials: true });
      this._eventSource = es;

      es.onopen = () => {
        this.connected = true;
        this.error = null;
      };

      /* ---- Event: new announcement ---- */
      es.addEventListener('announcement', (ev: MessageEvent) => {
        try {
          const announcement = JSON.parse(ev.data as string) as Announcement;

          // Upsert: replace if same id, else prepend
          const idx = this.items.findIndex((a) => a.id === announcement.id);
          if (idx >= 0) {
            this.items.splice(idx, 1, announcement);
          } else {
            this.items.unshift(announcement);
          }
        } catch (e) {
          console.warn('[announcements] bad SSE payload:', e);
        }
      });

      /* ---- Event: refresh (e.g. deactivation) ---- */
      es.addEventListener('refresh', () => {
        void this.fetchAnnouncements();
      });

      /* ---- Error / reconnect ---- */
      es.onerror = () => {
        this.connected = false;
        // No app timer and no close() here: the element is still CONNECTING and
        // about to retry by itself. Only once it has STOPPED retrying is there
        // anything left for the app to do.
        if (nativeRetryGivenUp(es)) this.replaceDeadStream(es);
      };

      this.watchVisibility();
    },

    /**
     * Drop a stream the native retry has abandoned and either re-open it (when
     * the runtime reports connectivity) or wait for `online`. Deliberately no
     * timer: one connection, one owner, no reconnect storms.
     */
    replaceDeadStream(dead: EventSource) {
      if (this._eventSource !== dead) return;
      this._eventSource = null;
      if (!navigator.onLine) {
        this.followOnline();
        return;
      }
      this.connectSSE();
    },

    /** Retry only once the runtime reports connectivity, never on a bare timer. */
    followOnline() {
      if (this._onlineListener) return;
      this._onlineListener = () => {
        this._onlineListener = null;
        this.connectSSE();
      };
      window.addEventListener('online', this._onlineListener, { once: true });
    },

    /**
     * Coming back to the foreground is the moment the user can actually see
     * announcements, and it is when a backgrounded WebView's killed connection
     * becomes visible. Re-open only if there is no live stream, at most once per
     * visibility transition, so it cannot become a reconnect storm.
     */
    watchVisibility() {
      if (typeof document === 'undefined' || this._visibilityListener) return;
      this._visibilityListener = () => {
        if (document.visibilityState !== 'visible') return;
        // A visible page whose stream is OPEN/CONNECTING needs nothing.
        if (this._eventSource && !nativeRetryGivenUp(this._eventSource)) return;
        this._eventSource = null;
        if (!this.connected) this.connectSSE();
      };
      document.addEventListener('visibilitychange', this._visibilityListener);
    },

    /**
     * Cleanly tear down the SSE connection and cancel pending reconnects.
     * Call this from `onUnmounted` or when navigating away.
     */
    disconnectSSE() {
      if (this._onlineListener && typeof window !== 'undefined') {
        window.removeEventListener('online', this._onlineListener);
        this._onlineListener = null;
      }
      if (this._visibilityListener && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this._visibilityListener);
        this._visibilityListener = null;
      }
      if (this._eventSource) {
        this._eventSource.close();
        this._eventSource = null;
      }
      this.connected = false;
    },

    /* ==============================================================
       Lifecycle helpers
       ============================================================== */

    /**
     * One-call init: fetch then stream.
     */
    async init() {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        await this.fetchAnnouncements();
      }
      this.connectSSE();
    },

    /**
     * Full teardown.
     */
    destroy() {
      this.disconnectSSE();
    },
  },
});

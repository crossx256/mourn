// =============================================
// Chains & Links — Pinia Store
// =============================================

import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { useAuthStore } from './auth';
import { captureAccountOperation } from 'src/utils/accountLifecycle';
import { useNotificationsStore } from './notifications';
import type { Link, LinkStatus, SearchUser } from 'src/types/links';
import {
  storeOfflineBlob,
  readOfflineBlob,
  isOfflineVaultEnabled,
  isOfflineModeAuthorized,
} from 'src/crypto/offlineVault';
import { encodeLinksPayload, decodeLinksPayload } from 'src/utils/offlineLinksCodec';

/** Offline vault id for the cached links snapshot (desktop only). */
const OFFLINE_LINKS_ID = 'links_snapshot';

export interface LinksState {
  links: Link[];
  /** Link IDs the user purged locally — hidden from list; server may still return SEVERED */
  locallyPurgedLinkIds: string[];
  searchResults: SearchUser[];
  searchLoading: boolean;
  linksLoading: boolean;
  error: string | null;
  /** True when the last fetch served the conversation list from the offline vault. */
  offline: boolean;
}

export const useLinksStore = defineStore('links', {
  state: (): LinksState => ({
    links: [],
    locallyPurgedLinkIds: [],
    searchResults: [],
    searchLoading: false,
    linksLoading: false,
    error: null,
    offline: false,
  }),

  getters: {
    /** Incoming pending requests (where current user is receiver) */
    incomingRequests(): Link[] {
      const authStore = useAuthStore();
      return this.links.filter(
        (link) => link.status === 'PENDING' && link.receiverId === authStore.user?.id,
      );
    },

    /** Outgoing pending requests (where current user is sender) */
    outgoingRequests(): Link[] {
      const authStore = useAuthStore();
      return this.links.filter((l) => l.status === 'PENDING' && l.senderId === authStore.user?.id);
    },

    /** Active chains (ESTABLISHED or ANCHORED) */
    activeChains(): Link[] {
      return this.links.filter((l) => l.status === 'ESTABLISHED' || l.status === 'ANCHORED');
    },

    /** Chats that have actually been accepted, plus locally retained severed chats. */
    chatChains(): Link[] {
      return this.links.filter(
        (link) =>
          link.status === 'ESTABLISHED' || link.status === 'ANCHORED' || link.status === 'SEVERED',
      );
    },

    /** Anchored links only */
    anchoredLinks(): Link[] {
      return this.links.filter((l) => l.status === 'ANCHORED');
    },

    /** ESTABLISHED (decaying) links only */
    decayingLinks(): Link[] {
      return this.links.filter((l) => l.status === 'ESTABLISHED');
    },

    severedLinks(): Link[] {
      return this.links.filter(
        (l) => l.status === 'SEVERED' && !this.locallyPurgedLinkIds.includes(l.id),
      );
    },
  },

  actions: {
    clearState() {
      const authStore = useAuthStore();
      const uid = authStore.user?.id;
      if (uid) {
        try {
          localStorage.removeItem(`mourn_links_purged_${uid}`);
        } catch {
          /* ignore */
        }
      }
      this.links = [];
      this.locallyPurgedLinkIds = [];
      this.searchResults = [];
      this.searchLoading = false;
      this.linksLoading = false;
      this.error = null;
      this.offline = false;

      // Durable offline snapshots are account-scoped. Logout clears memory,
      // not another account's cache through a late, unscoped deletion.
    },

    /** Load persisted purged IDs for the current user (no-op if not logged in). */
    hydrateLocallyPurgedIds() {
      const authStore = useAuthStore();
      const uid = authStore.user?.id;
      if (!uid) {
        this.locallyPurgedLinkIds = [];
        return;
      }
      try {
        const raw = localStorage.getItem(`mourn_links_purged_${uid}`);
        this.locallyPurgedLinkIds = raw ? (JSON.parse(raw) as string[]) : [];
      } catch {
        this.locallyPurgedLinkIds = [];
      }
    },

    persistLocallyPurgedIds() {
      const authStore = useAuthStore();
      const uid = authStore.user?.id;
      if (!uid) return;
      try {
        localStorage.setItem(
          `mourn_links_purged_${uid}`,
          JSON.stringify(this.locallyPurgedLinkIds),
        );
      } catch {
        /* ignore */
      }
    },

    unmarkLinkPurgedLocally(linkId: string) {
      if (!linkId || !this.locallyPurgedLinkIds.includes(linkId)) return;
      this.locallyPurgedLinkIds = this.locallyPurgedLinkIds.filter((id) => id !== linkId);
      this.persistLocallyPurgedIds();
    },

    shouldShowServerLink(link: Link): boolean {
      if (!this.locallyPurgedLinkIds.includes(link.id)) return true;

      // The backend resurrects SEVERED rows for relinks, keeping the same link id.
      // A local purge should hide only the old severed row, not a new pending/live link.
      if (link.status !== 'SEVERED') {
        this.unmarkLinkPurgedLocally(link.id);
        return true;
      }

      return false;
    },

    /** After purge: drop from UI and never re-show from API refetch. */
    markLinkPurgedLocally(linkId: string) {
      if (!linkId) return;
      if (this.locallyPurgedLinkIds.includes(linkId)) {
        this.links = this.links.filter((l) => l.id !== linkId);
        return;
      }
      this.locallyPurgedLinkIds = [...this.locallyPurgedLinkIds, linkId];
      this.persistLocallyPurgedIds();
      this.links = this.links.filter((l) => l.id !== linkId);
    },

    /** Update a single link's unread count and move it to top of chats list */
    updateLinkUnreadCount(linkId: string, newUnreadCount: number) {
      const link = this.links.find((l) => l.id === linkId);
      if (!link) return;
      link.unreadCount = newUnreadCount;
      // Move link to top of the list (most recently active)
      const idx = this.links.indexOf(link);
      if (idx > 0) {
        this.links.splice(idx, 1);
        this.links.unshift(link);
      }
      this.links = [...this.links];
    },

    // ───── Search ─────
    async searchUsers(query: string) {
      if (query.trim().length < 1) {
        this.searchResults = [];
        return;
      }
      this.searchLoading = true;
      this.error = null;
      try {
        const { data } = await api.get('/api/v1/search/users', { params: { q: query } });
        this.searchResults = data.data;
      } catch (err: unknown) {
        this.error = (err as Error).message;
        this.searchResults = [];
      } finally {
        this.searchLoading = false;
      }
    },

    // ───── Fetch all links ─────
    async fetchLinks(statusOrOptions?: LinkStatus | { status?: LinkStatus; silent?: boolean }) {
      const operation = captureAccountOperation();
      const accountId = operation.uid;
      const status =
        typeof statusOrOptions === 'string' ? statusOrOptions : statusOrOptions?.status;
      const silent =
        typeof statusOrOptions === 'object' && statusOrOptions !== null
          ? statusOrOptions.silent === true
          : false;

      if (!silent) {
        this.linksLoading = true;
      }
      this.error = null;
      if (!status) {
        this.offline = false;
      }
      this.hydrateLocallyPurgedIds();
      try {
        const params = status ? { status } : {};
        const { data } = await operation.wait(() => api.get('/api/v1/links', { params }));
        this.links = (data.data as Link[]).filter((l: Link) => this.shouldShowServerLink(l));

        // Reconcile persisted unread state after an offline sever/expiry. These
        // chats cannot be opened to trigger the normal read path, so clear their
        // message badges as soon as the authoritative link list says SEVERED.
        const inactiveLinkIds = this.links
          .filter((link) => link.status === 'SEVERED')
          .map((link) => link.id);
        if (inactiveLinkIds.length > 0) {
          const [{ useVaultStore }, { useNotificationsStore }] = await Promise.all([
            import('./vault'),
            import('./notifications'),
          ]);
          operation.assertCurrent();
          const vaultStore = useVaultStore();
          const notificationsStore = useNotificationsStore();
          for (const linkId of inactiveLinkIds) {
            vaultStore.markLinkRead(linkId);
            notificationsStore.removeNotificationByLinkId(linkId);
          }
        }

        // Cache the full conversation list encrypted (desktop only) so messaging
        // is readable offline. Links metadata is separate from message plaintext
        // (which lives in the vault-messages IndexedDB store). Never blocks the
        // online path on a storage failure.
        if (!status && accountId && isOfflineVaultEnabled()) {
          try {
            operation.assertCurrent();
            await storeOfflineBlob('messaging', OFFLINE_LINKS_ID, encodeLinksPayload(this.links), {
              savedAt: String(Date.now()),
              count: String(this.links.length),
            }, { kind: 'messaging', id: OFFLINE_LINKS_ID, accountId });
          } catch (offErr) {
            if (import.meta.env.DEV) {
              console.warn('[links] offline cache failed', offErr);
            }
          }
        }
      } catch (err: unknown) {
        operation.assertCurrent();
        // A genuine network failure (no HTTP status) → hydrate the cached
        // conversation list so messaging stays readable offline (desktop only).
        const axiosErr = err as { response?: unknown };
        if (!axiosErr.response && !status && isOfflineVaultEnabled()) {
          const hydrated = await operation.wait(() => this.hydrateOfflineLinks());
          if (hydrated) {
            this.offline = true;
            this.error = null;
            return;
          }
        }
        this.error = (err as Error).message;
      } finally {
        if (operation.isCurrent() && !silent) {
          this.linksLoading = false;
        }
      }
    },

    // ─── Read the cached conversation list from the offline vault. ───
    // SECURITY (krul 2026-08): the conversation list is account-private, so it
    // MAY only hydrate when offline mode is authorized — desktop + authenticated
    // on this device + "stay logged in". A fresh install that never signed in
    // with persistence gets nothing.
    async hydrateOfflineLinks(): Promise<boolean> {
      const operation = captureAccountOperation();
      if (!isOfflineVaultEnabled()) return false;
      const authed = await operation.wait(() => isOfflineModeAuthorized());
      if (!authed.authorized) return false;
      try {
        const bytes = await operation.wait(() => readOfflineBlob('messaging', OFFLINE_LINKS_ID));
        if (!bytes) return false;
        const cached = decodeLinksPayload(bytes);
        if (cached.length === 0) return false;
        this.links = cached.filter((l: Link) => this.shouldShowServerLink(l));
        return true;
      } catch (offErr) {
        if (import.meta.env.DEV) {
          console.warn('[links] offline hydrate failed', offErr);
        }
        return false;
      }
    },

    upsertLink(link: Link) {
      if (!this.shouldShowServerLink(link)) return;
      const idx = this.links.findIndex((l) => l.id === link.id);
      if (idx >= 0) {
        this.links[idx] = { ...this.links[idx], ...link };
      } else {
        this.links.unshift(link);
      }
      this.links = [...this.links];
    },

    // ───── Request link ─────
    async requestLink(receiverId: string, anchor = false) {
      this.error = null;
      try {
        const authStore = useAuthStore();
        await authStore.fetchCsrfToken();
        const { data } = await api.post(
          '/api/v1/links/request',
          { receiverId, anchor },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );
        // Optimistic: add to local store
        await this.fetchLinks();
        return data.data;
      } catch (err: unknown) {
        const message =
          (typeof err === 'object' &&
            err !== null &&
            'response' in err &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (err as any).response?.data?.error) ||
          (err as Error).message;
        this.error = message;
        throw new Error(message);
      }
    },

    // ───── Respond to link ─────
    async respondToLink(linkId: string, action: 'accept' | 'reject') {
      this.error = null;
      try {
        const authStore = useAuthStore();
        const notificationsStore = useNotificationsStore();
        await authStore.fetchCsrfToken();
        await api.post(
          '/api/v1/links/respond',
          { linkId, action },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );
        // Optimistic: update local state
        if (action === 'reject') {
          this.links = this.links.filter((l) => l.id !== linkId);
        } else {
          await this.fetchLinks();
        }
        // Drop any stale pending request notifications immediately
        notificationsStore.removeNotificationByLinkId(linkId);
      } catch (err: unknown) {
        const errorMsg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (err as Error).message;
        this.error = errorMsg;
        console.error('[Links] respondToLink error:', errorMsg, { linkId, action, fullErr: err });
        throw err;
      }
    },

    // ───── Sender cancels their own pending link request ─────
    async cancelLinkRequest(linkId: string) {
      this.error = null;
      try {
        const authStore = useAuthStore();
        const notificationsStore = useNotificationsStore();
        await authStore.fetchCsrfToken();
        await api.post(`/api/v1/links/request/${linkId}/cancel`, null, {
          headers: { 'X-CSRF-Token': authStore.csrfToken },
        });
        // Optimistic: remove the pending link locally so the Signals tab clears.
        this.links = this.links.filter((l) => l.id !== linkId);
        notificationsStore.removeNotificationByLinkId(linkId);
      } catch (err: unknown) {
        const errorMsg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (err as Error).message;
        this.error = errorMsg;
        console.error('[Links] cancelLinkRequest error:', errorMsg, { linkId, fullErr: err });
        throw err;
      }
    },

    // ───── Anchor a link ─────
    async anchorLink(linkId: string) {
      this.error = null;
      try {
        const authStore = useAuthStore();
        await authStore.fetchCsrfToken();
        const { data } = await api.post(
          '/api/v1/links/anchor',
          { linkId },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );
        // Optimistic update
        const idx = this.links.findIndex((l) => l.id === linkId);
        if (idx !== -1) {
          this.links[idx] = { ...this.links[idx], ...data.data };
        }
        return data.data;
      } catch (err: unknown) {
        this.error = (err as Error).message;
        throw err;
      }
    },

    // ───── Close & purge link ─────
    async closeLink(linkId: string) {
      return this.severLink(linkId, true);
    },

    // ───── Sever link (keep or purge) ─────
    async severLink(linkId: string, purge = false) {
      this.error = null;
      try {
        const authStore = useAuthStore();
        await authStore.fetchCsrfToken();
        const { data } = await api.post(
          '/api/v1/links/close',
          { linkId, purge },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );

        if (purge || data?.data?.purged) {
          this.markLinkPurgedLocally(linkId);
        } else if (data?.data) {
          this.upsertLink(data.data as Link);
        }
      } catch (err: unknown) {
        this.error = (err as Error).message;
        console.error('[Links] closeLink error:', err);
        throw err;
      }
    },

    // ───── Handle severed event from realtime ─────
    applySeveredEvent(payload: {
      linkId?: string;
      link?: Link;
      purged?: boolean;
      purgedLocally?: boolean;
    }) {
      const id = payload.link?.id ?? payload.linkId;
      if (id && this.locallyPurgedLinkIds.includes(id)) {
        return;
      }
      if (payload.link) {
        this.upsertLink(payload.link);
      } else if (payload.linkId) {
        const existing = this.links.find((l) => l.id === payload.linkId);
        if (existing) {
          existing.status = 'SEVERED';
          existing.expiresAt = null;
        }
      }
    },
  },
});

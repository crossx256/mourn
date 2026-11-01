// stores/broadcastStore.ts
//
// Pinia store for the encrypted ANNOUNCEMENT broadcast channel. The announcement
// channel is surfaced in the SUITES tab exactly like an MLS group, but it is
// NOT an MLS group — it uses the broadcast channel key-wrap scheme in
// crypto/broadcast.ts (server wraps the channel key to this device via a
// one-time X25519 grant; messages are XChaCha20 secretbox with that key).
//
// Contract (base path /api/v1/broadcast, authenticated via the app's `api`
// axios instance, same as groups):
//   GET    /broadcast/channel/:channelId   → channel meta (auto self-adds caller)
//   POST   /broadcast/:channelId/join      → { keyVersion, encryptedKey, nonce,
//                                             senderPub } key grant for THIS device
//   GET    /broadcast/:channelId/messages  → { keyVersion, messages:[...] }
//   POST   /broadcast/:channelId/messages  → { ciphertext, nonce } (ADMIN/OWNER only)
//   POST   /broadcast/:channelId/members/:userId/remove → ADMIN/OWNER (rotates key)
//   POST   /broadcast/:channelId/members/:userId/readd  → ADMIN/OWNER (re-grants key)
//   POST   /broadcast/:channelId/mute      → { muted: boolean }
//
// The channel key is held in-memory for the session only and is NEVER persisted
// to local storage. Re-unlock each session.

import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { useAuthStore } from './auth';
import { captureAccountOperation } from 'src/utils/accountLifecycle';
import { useVaultStore } from './vault';
import { unwrapChannelKeyGrant, broadcastEncrypt, broadcastDecrypt } from '../crypto/broadcast';
import { loadBroadcastHistory, saveBroadcastHistory } from '../crypto/broadcastLocalVault';
import { playNotificationSound } from '../utils/notificationSound';

/** The global announcement channel identifier (its slug). */
export const BROADCAST_CHANNEL_SLUG = 'mourn-announcements';

export interface BroadcastChannel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  keyVersion: number;
  muted: boolean;
  role: string;
  memberCount: number;
}

export interface BroadcastMessage {
  id: string;
  senderId: string;
  text: string;
  keyVersion: number;
  createdAt: string;
}

/** A channel roster entry (mirrors the normal suite member panel). */
export interface BroadcastRosterMember {
  userId: string;
  role: string;
  muted: boolean;
  username: string | null;
  displayName: string | null;
  profilePicture: string | null;
}

/** Shape returned by POST /broadcast/:channelId/messages (decrypted locally). */
export interface BroadcastSendResult {
  id: string;
  keyVersion: number;
  createdAt: string;
}

interface BroadcastGrant {
  keyVersion: number;
  encryptedKey: string;
  nonce: string;
  senderPub: string;
}

// The E2E channel key, held ONLY in memory for this session. Kept outside
// Pinia reactive state (it's a raw byte buffer we never want to proxy/persist);
// re-unwrapped on every session unlock.
let channelKey: Uint8Array | null = null;
let channelKeyOwnerId: string | null = null;

export function getActiveChannelKey(): Uint8Array | null {
  return channelKey;
}

function mergeMessages(...collections: BroadcastMessage[][]): BroadcastMessage[] {
  const byId = new Map<string, BroadcastMessage>();
  for (const messages of collections) {
    for (const message of messages) byId.set(message.id, message);
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-500);
}

interface BroadcastStoreState {
  activeChannel: BroadcastChannel | null;
  activeChannelSlug: string | null;
  messages: BroadcastMessage[];
  members: BroadcastRosterMember[];
  channelKeyVersion: number | null;
  unlocked: boolean;
  /** The local user's role on this channel ('' until loaded). */
  role: string;
  muted: boolean;
  loading: boolean;
  messagesLoading: boolean;
  historyLoaded: boolean;
  unlocking: boolean;
  lastError: string | null;
  unreadCount: number;
  viewing: boolean;
}

export const useBroadcastStore = defineStore('broadcast', {
  state: (): BroadcastStoreState => ({
    activeChannel: null,
    activeChannelSlug: null,
    messages: [],
    members: [],
    channelKeyVersion: null,
    unlocked: false,
    role: '',
    muted: false,
    loading: false,
    messagesLoading: false,
    historyLoaded: false,
    unlocking: false,
    lastError: null,
    unreadCount: 0,
    viewing: false,
  }),

  getters: {
    /** True when the active user can post (broadcast is ADMIN/OWNER only). */
    canSend(state): boolean {
      const role = state.role || state.activeChannel?.role || '';
      return role === 'OWNER' || role === 'ADMIN';
    },
    /** True when the active user is an admin/owner (can remove/readd members). */
    isAdmin(): boolean {
      const role = this.role || this.activeChannel?.role || '';
      return role === 'OWNER' || role === 'ADMIN';
    },
    /** Roster grouped owner → admins → members (mirrors the suite panel). */
    groupedMembers(): {
      owners: BroadcastRosterMember[];
      admins: BroadcastRosterMember[];
      members: BroadcastRosterMember[];
    } {
      const owners = this.members.filter((m) => m.role === 'OWNER');
      const admins = this.members.filter((m) => m.role === 'ADMIN');
      const users = this.members.filter((m) => m.role !== 'OWNER' && m.role !== 'ADMIN');
      return { owners, admins, members: users };
    },
  },

  actions: {
    clearState() {
      this.activeChannel = null;
      this.activeChannelSlug = null;
      this.messages = [];
      this.members = [];
      this.channelKeyVersion = null;
      this.unlocked = false;
      this.role = '';
      this.muted = false;
      this.loading = false;
      this.messagesLoading = false;
      this.historyLoaded = false;
      this.unlocking = false;
      this.lastError = null;
      this.unreadCount = 0;
      this.viewing = false;
      channelKey = null;
      channelKeyOwnerId = null;
    },

    /**
     * Fetch the announcement channel meta (GET /broadcast/channel/:slug).
     * The backend auto-self-adds the caller as a member if they aren't one,
     * so this call is also the idempotent "join" for the member list.
     */
    async fetchChannel(): Promise<BroadcastChannel | null> {
      const operation = captureAccountOperation();
      const authStore = useAuthStore();
      if (!authStore.isLoggedIn || !authStore.user?.id) return null;

      this.loading = true;
      this.lastError = null;
      try {
        const { data } = await operation.wait(async () => api.get<BroadcastChannel>(
          `/api/v1/broadcast/channel/mourn-announcements`,
        ));
        this.activeChannel = data;
        this.activeChannelSlug = data.slug || 'mourn-announcements';
        this.channelKeyVersion = data.keyVersion;
        this.muted = data.muted === true;
        this.role = data.role || '';
        return data;
      } catch (err) {
        operation.assertCurrent();
        console.error('[BroadcastStore] fetchChannel failed:', err);
        this.lastError = this.errorMessage(err, 'Failed to load announcement channel');
        return null;
      } finally {
        if (operation.isCurrent()) {
        this.loading = false;

        }
      }
    },

    /**
     * Unwrap this session's channel key from the server grant. Never persisted
     * — re-unwrapped on each session unlock.
     */
    async unlock(): Promise<boolean> {
      const operation = captureAccountOperation();
      const slug = this.activeChannelSlug ?? BROADCAST_CHANNEL_SLUG;
      if (!this.activeChannel) {
        await operation.wait(async () => this.fetchChannel());
      }
      const currentUserId = useAuthStore().user?.id ?? null;
      if (this.unlocked && channelKey && channelKeyOwnerId === currentUserId) return true;
      if (this.unlocking) return this.unlocked && Boolean(channelKey);

      this.unlocking = true;
      this.lastError = null;
      try {
        const grant = await operation.wait(async () => this.authed<BroadcastGrant>(
          'post',
          `/api/v1/broadcast/${slug}/join`,
          {},
        ));
        if (!grant?.encryptedKey || !grant?.nonce || !grant?.senderPub) {
          throw new Error('Malformed broadcast key grant');
        }
        const vaultStore = useVaultStore();
        const uid = useAuthStore().user?.id ?? vaultStore.getStorageUid();
        const devPriv =
          (uid ? await operation.wait(async () => vaultStore.keyManager.getStoredKey(`vault_device_priv_${uid}`)) : null) ??
          null;
        const key = await operation.wait(async () => unwrapChannelKeyGrant(grant, devPriv));
        if (!key) {
          throw new Error('Could not unwrap broadcast channel key (device key mismatch)');
        }
        channelKey = key;
        channelKeyOwnerId = currentUserId;
        this.unlocked = true;
        this.channelKeyVersion = grant.keyVersion;
        return true;
      } catch (err) {
        operation.assertCurrent();
        console.error('[BroadcastStore] unlock failed:', err);
        this.lastError = this.errorMessage(err, 'Failed to unlock announcement channel');
        this.unlocked = false;
        channelKey = null;
        channelKeyOwnerId = null;
        return false;
      } finally {
        if (operation.isCurrent()) {
        this.unlocking = false;

        }
      }
    },

    async hydrateCachedHistory(): Promise<void> {
      const operation = captureAccountOperation();
      const userId = operation.uid;
      if (!userId) return;
      try {
        const cached = await operation.wait(async () => loadBroadcastHistory(userId, BROADCAST_CHANNEL_SLUG));
        this.messages = mergeMessages(cached, this.messages);
      } catch (err) {
        operation.assertCurrent();
        console.warn('[BroadcastStore] Failed to load encrypted local history', err);
      }
    },

    /**
     * Fetch + decrypt the channel's message history. Messages from old key
     * versions remain available when this device previously cached them.
     */
    async loadHistory(options: { background?: boolean; notify?: boolean } = {}): Promise<void> {
      const operation = captureAccountOperation();
      const slug = this.activeChannelSlug ?? BROADCAST_CHANNEL_SLUG;
      if (!channelKey) {
        const ok = await operation.wait(async () => this.unlock());
        if (!ok || !channelKey) return;
      }

      if (!options.background) this.messagesLoading = true;
      this.lastError = null;
      try {
        const { data } = await operation.wait(async () => api.get<{
          keyVersion: number;
          messages: Array<{
            id: string;
            senderId: string;
            ciphertext: string;
            nonce: string;
            keyVersion: number;
            createdAt: string;
          }>;
        }>(`/api/v1/broadcast/${slug}/messages`));
        if (this.channelKeyVersion !== data.keyVersion) {
          this.unlocked = false;
          channelKey = null;
          channelKeyOwnerId = null;
          const ok = await operation.wait(async () => this.unlock());
          if (!ok || !channelKey) return;
        }
        this.channelKeyVersion = data.keyVersion;
        const decryptionKey = channelKey;
        const decrypted: BroadcastMessage[] = [];
        for (const m of data.messages ?? []) {
          try {
            const text = await operation.wait(async () => broadcastDecrypt(decryptionKey, m.ciphertext, m.nonce));
            if (text !== null) {
              decrypted.push({
                id: m.id,
                senderId: m.senderId,
                text,
                keyVersion: m.keyVersion,
                createdAt: m.createdAt,
              });
            }
          } catch (err) {
        operation.assertCurrent();
            console.warn('[BroadcastStore] drop undecryptable message', m.id, err);
          }
        }
        const previousIds = new Set(this.messages.map((message) => message.id));
        const newMessages = decrypted.filter((message) => !previousIds.has(message.id));
        this.messages = mergeMessages(this.messages, decrypted);
        this.historyLoaded = true;
        if (options.notify && newMessages.some((message) => message.senderId !== useAuthStore().user?.id)) {
          this.unreadCount += newMessages.length;
          if (!this.muted) await operation.wait(async () => playNotificationSound().catch(() => {}));
        }
        const userId = useAuthStore().user?.id;
        if (userId) {
          try {
            await operation.wait(async () => saveBroadcastHistory(userId, BROADCAST_CHANNEL_SLUG, this.messages));
          } catch (cacheErr) {
        operation.assertCurrent();
            console.warn('[BroadcastStore] Failed to persist encrypted local history', cacheErr);
          }
        }
      } catch (err) {
        operation.assertCurrent();
        console.error('[BroadcastStore] loadHistory failed:', err);
        this.lastError = this.errorMessage(err, 'Failed to load announcement history');
      } finally {
        if (operation.isCurrent()) {
        if (!options.background) this.messagesLoading = false;

        }
      }
    },

    /**
     * Fetch the channel roster (member-only). Admin uses it to pick a member
     * to remove / re-add. Returns the grouped roster list.
     */
    async fetchMembers(): Promise<BroadcastRosterMember[]> {
      const operation = captureAccountOperation();
      const slug = this.activeChannelSlug ?? BROADCAST_CHANNEL_SLUG;
      try {
        const { data } = await operation.wait(async () => api.get<{ members: BroadcastRosterMember[] }>(
          `/api/v1/broadcast/${slug}/members`,
        ));
        this.members = data.members ?? [];
        return this.members;
      } catch (err) {
        operation.assertCurrent();
        console.error('[BroadcastStore] fetchMembers failed:', err);
        this.lastError = this.errorMessage(err, 'Failed to load members');
        return [];
      }
    },

    /**
     * Send an announcement. Only admins/owners may post.
     */
    async send(text: string): Promise<BroadcastSendResult | null> {
      const operation = captureAccountOperation();
      const slug = this.activeChannelSlug ?? BROADCAST_CHANNEL_SLUG;
      if (!this.canSend) throw new Error('only admins can broadcast');
      if (!channelKey) {
        const ok = await operation.wait(async () => this.unlock());
        if (!ok || !channelKey) throw new Error('Announcement channel is locked');
      }
      const body = text.trim();
      if (!body) return null;

      const postWithCurrentKey = async (): Promise<BroadcastSendResult> => {
        if (!channelKey || this.channelKeyVersion === null) {
          throw new Error('Announcement channel is locked');
        }
        const keyVersion = this.channelKeyVersion;
        const encryptionKey = channelKey;
        const { ciphertext, nonce } = await operation.wait(async () => broadcastEncrypt(encryptionKey, body));
        return this.authed<BroadcastSendResult>('post', `/api/v1/broadcast/${slug}/messages`, {
          ciphertext,
          nonce,
          keyVersion,
        });
      };

      try {
        const sent = await operation.wait(async () => postWithCurrentKey());
        this.messages = mergeMessages(this.messages, [{
          id: sent.id,
          senderId: useAuthStore().user?.id ?? '',
          text: body,
          keyVersion: sent.keyVersion,
          createdAt: sent.createdAt,
        }]);
        const userId = useAuthStore().user?.id;
        if (userId) await operation.wait(async () => saveBroadcastHistory(userId, BROADCAST_CHANNEL_SLUG, this.messages));
        return sent;
      } catch (err) {
        operation.assertCurrent();
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 409) {
          this.unlocked = false;
          channelKey = null;
          channelKeyOwnerId = null;
          const unlocked = await operation.wait(async () => this.unlock());
          if (unlocked) {
            const sent = await operation.wait(async () => postWithCurrentKey());
            this.messages = mergeMessages(this.messages, [{
              id: sent.id,
              senderId: useAuthStore().user?.id ?? '',
              text: body,
              keyVersion: sent.keyVersion,
              createdAt: sent.createdAt,
            }]);
            return sent;
          }
        }
        console.error('[BroadcastStore] send failed:', err);
        this.lastError = this.errorMessage(err, 'Failed to broadcast announcement');
        throw err;
      }
    },

    setViewing(viewing: boolean): void {
      this.viewing = viewing;
      if (viewing) this.unreadCount = 0;
    },

    markRead(): void {
      this.unreadCount = 0;
    },

    /** Set the caller's own mute state for the channel. */
    async setMuted(muted: boolean): Promise<boolean> {
      const operation = captureAccountOperation();
      const slug = this.activeChannelSlug ?? BROADCAST_CHANNEL_SLUG;
      try {
        await operation.wait(async () => this.authed('post', `/api/v1/broadcast/${slug}/mute`, { muted }));
        this.muted = muted;
        if (this.activeChannel) this.activeChannel.muted = muted;
        return true;
      } catch (err) {
        operation.assertCurrent();
        console.error('[BroadcastStore] setMuted failed:', err);
        this.lastError = this.errorMessage(err, 'Failed to update mute state');
        return false;
      }
    },

    /**
     * Remove a member (ADMIN/OWNER only). Server rotates the channel key and
     * re-wraps it to all remaining devices; re-unlock the next time we act.
     */
    async removeMember(userId: string, isAdmin: boolean): Promise<boolean> {
      const operation = captureAccountOperation();
      if (!isAdmin) throw new Error('only admins can remove members');
      const slug = this.activeChannelSlug ?? BROADCAST_CHANNEL_SLUG;
      if (!userId) return false;
      try {
        await operation.wait(async () => this.authed(
          'post',
          `/api/v1/broadcast/${slug}/members/${encodeURIComponent(userId)}/remove`,
          {},
        ));
        this.unlocked = false;
        this.historyLoaded = false;
        channelKey = null;
        channelKeyOwnerId = null;
        return true;
      } catch (err) {
        operation.assertCurrent();
        console.error('[BroadcastStore] removeMember failed:', err);
        this.lastError = this.errorMessage(err, 'Failed to remove member');
        return false;
      }
    },

    /** Re-add a member (ADMIN/OWNER only). Grants them the current channel key. */
    async readdMember(userId: string, isAdmin: boolean): Promise<boolean> {
      const operation = captureAccountOperation();
      if (!isAdmin) throw new Error('only admins can re-add members');
      const slug = this.activeChannelSlug ?? BROADCAST_CHANNEL_SLUG;
      if (!userId) return false;
      try {
        await operation.wait(async () => this.authed(
          'post',
          `/api/v1/broadcast/${slug}/members/${encodeURIComponent(userId)}/readd`,
          {},
        ));
        this.unlocked = false;
        this.historyLoaded = false;
        channelKey = null;
        channelKeyOwnerId = null;
        return true;
      } catch (err) {
        operation.assertCurrent();
        console.error('[BroadcastStore] readdMember failed:', err);
        this.lastError = this.errorMessage(err, 'Failed to re-add member');
        return false;
      }
    },

    /**
     * Idempotent one-call init: fetchChannel + unlock + loadHistory. Used from
     * the vault-init hook and the UI. If already unlocked for this channel it
     * no-ops (guards against duplicate unlock races).
     */
    async ensureInit(): Promise<void> {
      const operation = captureAccountOperation();
      const authStore = useAuthStore();
      if (!authStore.isLoggedIn || !authStore.user?.id) return;
      if (channelKeyOwnerId && channelKeyOwnerId !== authStore.user.id) {
        this.clearState();
      }
      if (this.messages.length === 0) {
        await operation.wait(async () => this.hydrateCachedHistory());
      }

      if (!this.activeChannel) {
        await operation.wait(async () => this.fetchChannel());
      } else if (this.unlocked && channelKey && this.historyLoaded) {
        // Reconcile durable ciphertext on every Vault init/reconnect so messages
        // posted while this device was offline are not skipped.
        await operation.wait(async () => this.loadHistory({ background: true, notify: !this.viewing }));
        return;
      }

      if (!this.unlocked || !channelKey) {
        const ok = await operation.wait(async () => this.unlock());
        if (!ok) return;
      }
      if (!this.historyLoaded) {
        await operation.wait(async () => this.loadHistory({ notify: !this.viewing }));
      }
    },

    /** State-changing calls need a CSRF token; mirrors groupStore.authed. */
    async authed<T = unknown>(
      method: 'post' | 'patch' | 'delete',
      url: string,
      payload?: unknown,
    ): Promise<T> {
      const operation = captureAccountOperation();
      const authStore = useAuthStore();

      async function attempt(): Promise<T> {
        await operation.wait(async () => authStore.fetchCsrfToken());
        const token = authStore.csrfToken || '';
        const headers = token ? { 'X-CSRF-Token': token } : {};
        if (method === 'post') {
          const { data } = await operation.wait(async () => api.post<T>(url, payload, { headers }));
          return data;
        }
        if (method === 'patch') {
          const { data } = await operation.wait(async () => api.patch<T>(url, payload, { headers }));
          return data;
        }
        const { data } = await operation.wait(async () => api.delete<T>(url, { headers }));
        return data;
      }

      try {
        return await operation.wait(async () => attempt());
      } catch (err) {
        operation.assertCurrent();
        if (
          err instanceof Error &&
          (err.message.includes('csrf') ||
            (err as { response?: { status?: number } })?.response?.status === 403)
        ) {
          return attempt();
        }
        throw err;
      }
    },

    errorMessage(err: unknown, fallback: string): string {
      const response = (err as { response?: { data?: { error?: string } } })?.response;
      return (response?.data?.error as string) || (err as Error)?.message || fallback;
    },
  },
});

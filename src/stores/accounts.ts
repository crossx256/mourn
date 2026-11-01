import { defineStore } from 'pinia';
import { get, set } from 'idb-keyval';

const STORAGE_KEY = 'mourn_saved_accounts';
const INACTIVE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_SAVED_ACCOUNTS = 2;

export interface SavedAccount {
  id: string;
  username: string;
  displayName: string | null;
  profilePicture: string | null;
  lastActiveAt: number; // timestamp ms
}

interface AccountsState {
  accounts: SavedAccount[];
  activeAccountId: string | null;
  loaded: boolean;
}

export const useAccountsStore = defineStore('accounts', {
  state: (): AccountsState => ({
    accounts: [],
    activeAccountId: null,
    loaded: false,
  }),

  getters: {
    savedAccounts: (state) => state.accounts,
    activeAccount: (state) => state.accounts.find((a) => a.id === state.activeAccountId) ?? null,
    inactiveAccounts: (state) => state.accounts.filter((a) => a.id !== state.activeAccountId),
  },

  actions: {
    async load() {
      if (this.loaded) return;
      try {
        const saved = await get<SavedAccount[]>(STORAGE_KEY);
        if (saved && Array.isArray(saved)) {
          // Prune expired accounts (inactive > 30 days)
          const now = Date.now();
          this.accounts = saved
            .filter((a) => now - a.lastActiveAt < INACTIVE_EXPIRY_MS)
            .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
            .slice(0, MAX_SAVED_ACCOUNTS);
          if (this.accounts.length !== saved.length) {
            await this.persist();
          }
        }
      } catch (err) {
        console.error('[Accounts] Failed to load saved accounts', err);
      }
      this.loaded = true;
    },

    async persist() {
      try {
        const plain = JSON.parse(JSON.stringify(this.accounts));
        await set(STORAGE_KEY, plain);
      } catch (err) {
        console.error('[Accounts] Failed to persist accounts', err);
      }
    },

    async saveAccount(user: {
      id: string;
      username: string;
      profile?: { displayName?: string | null; profilePicture?: string | null } | null;
    }, isCurrent: () => boolean = () => true) {
      await this.load();
      if (!isCurrent()) return;

      const existing = this.accounts.find((a) => a.id === user.id);
      const entry: SavedAccount = {
        id: user.id,
        username: user.username,
        displayName: user.profile?.displayName ?? null,
        profilePicture: user.profile?.profilePicture ?? null,
        lastActiveAt: Date.now(),
      };

      if (existing) {
        Object.assign(existing, entry);
      } else {
        this.accounts.push(entry);
      }

      this.accounts.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
      if (this.accounts.length > MAX_SAVED_ACCOUNTS) {
        this.accounts = this.accounts.slice(0, MAX_SAVED_ACCOUNTS);
      }

      this.activeAccountId = user.id;
      await this.persist();
    },

    async removeAccount(userId: string) {
      this.accounts = this.accounts.filter((a) => a.id !== userId);
      if (this.activeAccountId === userId) {
        this.activeAccountId = null;
      }
      await this.persist();
    },

    async setActive(userId: string) {
      const acc = this.accounts.find((a) => a.id === userId);
      if (acc) {
        acc.lastActiveAt = Date.now();
        this.activeAccountId = userId;
        await this.persist();
      }
    },

    async touchActive() {
      if (!this.activeAccountId) return;
      const acc = this.accounts.find((a) => a.id === this.activeAccountId);
      if (acc) {
        acc.lastActiveAt = Date.now();
        await this.persist();
      }
    },

    clearActive() {
      this.activeAccountId = null;
    },
  },
});

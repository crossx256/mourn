import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { useAuthStore } from './auth';
import { captureAccountOperation } from 'src/utils/accountLifecycle';

const syncTimers = new WeakMap<object, number>();

// Invoke Tauri commands via the injected IPC bridge (no @tauri-apps/api dep needed).
function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const internals = window.__TAURI_INTERNALS__ as
    { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<T> } | undefined;
  if (!internals?.invoke) throw new Error('not running in Tauri');
  return internals.invoke(cmd, args);
}

function hasTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
}

export type WatcherLevel = 1 | 2 | 3;

export interface WatcherLogEntry {
  id: string;
  eventType: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata?: Record<string, unknown> | null;
  success: boolean;
  createdAt: string;
}

interface WatcherState {
  watcherLevel: WatcherLevel;
  alertEmail: string | null;
  pendingAlertEmail: string | null;
  accountEmail: string | null;
  logs: WatcherLogEntry[];
  logsLoading: boolean;
  settingsLoading: boolean;
  maxLocalEntries: number; // Level 2: how many entries the desktop app should keep
}

export const useWatcherStore = defineStore('watcher', {
  state: (): WatcherState => ({
    watcherLevel: 1,
    alertEmail: null,
    pendingAlertEmail: null,
    accountEmail: null,
    logs: [],
    logsLoading: false,
    settingsLoading: false,
    maxLocalEntries: 200,
  }),

  getters: {
    effectiveAlertEmail(state): string | null {
      return state.alertEmail || state.accountEmail;
    },
    levelLabel(state): string {
      if (state.watcherLevel === 3) return 'cloud backup';
      if (state.watcherLevel === 2) return 'watcher mode';
      return 'standard';
    },
  },

  actions: {
    // ─── Fetch current settings from API ──────────────
    async fetchSettings() {
      this.settingsLoading = true;
      try {
        const { data } = await api.get('/api/v1/watcher/settings');
        if (data.success) {
          this.watcherLevel = data.data.watcherLevel as WatcherLevel;
          this.alertEmail = data.data.alertEmail;
          this.pendingAlertEmail = data.data.pendingAlertEmail ?? null;
          this.accountEmail = data.data.accountEmail;
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Watcher settings fetch failed', error);
      } finally {
        this.settingsLoading = false;
      }
    },

    // ─── Update level or alert email ──────────────────
    async updateSettings(patch: {
      watcherLevel?: WatcherLevel;
      alertEmail?: string | null;
      currentPassword: string;
    }) {
      const authStore = useAuthStore();
      await authStore.fetchCsrfToken();
      const { data } = await api.patch('/api/v1/watcher/settings', patch, {
        headers: {
          'X-CSRF-Token': authStore.csrfToken,
          'Content-Type': 'application/json',
        },
      });
      if (data.success) {
        if (data.data.watcherLevel !== undefined) this.watcherLevel = data.data.watcherLevel;
        if (data.data.alertEmail !== undefined) this.alertEmail = data.data.alertEmail;
        if (data.data.pendingAlertEmail !== undefined) {
          this.pendingAlertEmail = data.data.pendingAlertEmail;
        }
      }
      return data.success;
    },

    async requestAlertEmailVerification(email: string | null, currentPassword: string) {
      const authStore = useAuthStore();
      await authStore.fetchCsrfToken();
      const { data } = await api.patch(
        '/api/v1/watcher/settings',
        { alertEmail: email, currentPassword },
        {
          headers: {
            'X-CSRF-Token': authStore.csrfToken,
            'Content-Type': 'application/json',
          },
        },
      );

      if (data.success) {
        if (data.data.watcherLevel !== undefined) this.watcherLevel = data.data.watcherLevel;
        if (data.data.alertEmail !== undefined) this.alertEmail = data.data.alertEmail;
        if (data.data.pendingAlertEmail !== undefined) {
          this.pendingAlertEmail = data.data.pendingAlertEmail;
        }
      }

      return data;
    },

    async confirmAlertEmailVerification(code: string) {
      const authStore = useAuthStore();
      await authStore.fetchCsrfToken();
      const { data } = await api.post(
        '/api/v1/watcher/email/verify',
        { code },
        {
          headers: {
            'X-CSRF-Token': authStore.csrfToken,
            'Content-Type': 'application/json',
          },
        },
      );

      if (data.success) {
        this.alertEmail = data.data.alertEmail ?? this.alertEmail;
        this.pendingAlertEmail = data.data.pendingAlertEmail ?? null;
      }

      return data;
    },

    async cancelPendingAlertEmail() {
      const authStore = useAuthStore();
      await authStore.fetchCsrfToken();
      const { data } = await api.post(
        '/api/v1/watcher/email/cancel',
        {},
        {
          headers: {
            'X-CSRF-Token': authStore.csrfToken,
            'Content-Type': 'application/json',
          },
        },
      );

      if (data.success) {
        this.alertEmail = data.data.alertEmail ?? this.alertEmail;
        this.pendingAlertEmail = data.data.pendingAlertEmail ?? null;
      }

      return data;
    },

    // ─── Fetch cloud logs (Level 3) ───────────────────
    async fetchCloudLogs(limit = 50) {
      this.logsLoading = true;
      try {
        const { data } = await api.get('/api/v1/watcher/logs', { params: { limit } });
        if (data.success) {
          this.logs = data.data.logs as WatcherLogEntry[];
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Watcher cloud logs fetch failed', error);
      } finally {
        this.logsLoading = false;
      }
    },

    // ─── Fetch local logs via Tauri (Level 2) ─────────
    async fetchLocalLogs() {
      const operation = captureAccountOperation();
      if (!operation.uid) return;
      this.logsLoading = true;
      try {
        if (hasTauri()) {
          const rows = await tauriInvoke<WatcherLogEntry[]>('watcher_get_logs', {
            accountId: operation.uid,
            limit: this.maxLocalEntries,
          });
          operation.assertCurrent();
          this.logs = rows;
        } else {
          // Not running in desktop — leave logs empty
          this.logs = [];
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Watcher local logs fetch failed', error);
        if (operation.isCurrent()) this.logs = [];
      } finally {
        if (operation.isCurrent()) this.logsLoading = false;
      }
    },

    // ─── Load logs based on current level ─────────────
    async loadLogs() {
      if (this.watcherLevel === 3) {
        await this.fetchCloudLogs();
      } else if (this.watcherLevel === 2) {
        await this.fetchLocalLogs();
      } else {
        this.logs = [];
      }
    },

    // ─── Claim pending server logs and store locally (Level 2) ──
    async claimPendingLogs(): Promise<number> {
      if (this.watcherLevel !== 2) return 0;
      if (!hasTauri()) return 0;
      const operation = captureAccountOperation();
      if (!operation.uid) return 0;

      try {
        const authStore = useAuthStore();
        await operation.wait(() => authStore.fetchCsrfToken());

        const { data } = await operation.wait(() => api.post(
          '/api/v1/watcher/claim',
          {},
          {
            headers: {
              'X-CSRF-Token': authStore.csrfToken,
              'Content-Type': 'application/json',
            },
          },
        ));
        if (!data.success || !data.data?.logs?.length) return 0;

        const claimed = data.data.logs as WatcherLogEntry[];

        for (const entry of claimed) {
          operation.assertCurrent();
          await tauriInvoke('watcher_insert_log', {
            accountId: operation.uid,
            entry: {
              id: null,
              eventType: entry.eventType,
              ipAddress: entry.ipAddress,
              userAgent: entry.userAgent,
              metadata: entry.metadata ?? null,
              success: entry.success,
              createdAt: entry.createdAt,
            },
            maxEntries: this.maxLocalEntries,
          });
        }

        // The write keeps its original account even if logout occurred mid-IPC.
        operation.assertCurrent();
        await this.fetchLocalLogs();
        return claimed.length;
      } catch (error) {
        if (import.meta.env.DEV) console.error('Watcher claim failed', error);
        return 0;
      }
    },

    // ─── Start periodic sync (call once on app mount) ─────────
    startSyncInterval() {
      this.stopSyncInterval();
      // Immediate claim on start
      void this.claimPendingLogs();
      // Then every 30 minutes
      const THIRTY_MIN = 30 * 60 * 1000;
      const id = window.setInterval(() => {
        void this.claimPendingLogs();
      }, THIRTY_MIN);
      syncTimers.set(this, id);
    },

    stopSyncInterval() {
      const timerId = syncTimers.get(this);
      if (timerId !== undefined) clearInterval(timerId);
      syncTimers.delete(this);
    },

    // ─── Clear all local logs via Tauri ───────────────
    async clearLocalLogs(): Promise<boolean> {
      if (!hasTauri()) return false;
      const operation = captureAccountOperation();
      if (!operation.uid) return false;
      try {
        await operation.wait(() => tauriInvoke('watcher_clear_logs', { accountId: operation.uid }));
        // Re-read from the local DB (source of truth) so the view reflects the
        // actual cleared state instead of assuming it — this also surfaces any
        // rows that were re-inserted by an in-flight claim in the same tick.
        await this.fetchLocalLogs();
        return this.logs.length === 0;
      } catch (error) {
        if (import.meta.env.DEV) console.error('Watcher clear failed', error);
        return false;
      }
    },
  },
});

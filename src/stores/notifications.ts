import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { useAuthStore } from 'stores/auth';
import { captureAccountOperation } from 'src/utils/accountLifecycle';
import { playNotificationSound } from 'src/utils/notificationSound';

// ---------------------------------
// ✨ NOTIFICATIONS STORE
// ---------------------------------

export interface Notification {
  id: string;
  type: 'LINK_REQUEST' | 'GROUP_JOIN_REQUEST' | 'GROUP_JOIN_ACCEPTED' | 'OTHER';
  title: string;
  message: string;
  data: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationsState {
  notifications: Notification[];
  loading: boolean;
  error: string | null;
}

export const useNotificationsStore = defineStore('notifications', {
  state: (): NotificationsState => ({
    notifications: [],
    loading: false,
    error: null,
  }),

  getters: {
    unreadCount(): number {
      return this.notifications.filter((n) => !n.isRead).length;
    },
  },

  actions: {
    getCsrfFromCookie(): string {
      if (typeof document === 'undefined') return '';
      const cookie = document.cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('csrfToken='));
      return cookie ? decodeURIComponent(cookie.slice('csrfToken='.length)) : '';
    },

    async fetchNotifications() {
      const operation = captureAccountOperation();
      this.loading = true;
      this.error = null;
      try {
        const response = await operation.wait(async () => api.get('/api/v1/notifications'));
        const fresh: Notification[] = response.data?.data || [];

        // Detect notifications that arrived since our last view. The socket only
        // fires while the app is OPEN; when Mourn launches (or reconnects) the
        // startup fetch below is the moment an offline-created notification (e.g.
        // a graveyard letter decision, type OTHER) becomes visible. To honor the
        // "alert next time they open Mourn (with the notification sound)"
        // requirement, ring once if there is any NEW unread item we haven't seen.
        const knownIds = new Set(this.notifications.map((n) => n.id));
        const hasNewUnread = fresh.some((n) => !n.isRead && !knownIds.has(n.id));

        this.notifications = fresh;

        if (hasNewUnread) {
          // Single chime for the new batch (mirrors the vault ">3 -> one chime"
          // pattern) — do NOT ring once per notification.
          void playNotificationSound().catch(() => {
            // Audio not available, silent fail
          });
        }
      } catch (err: unknown) {
        operation.assertCurrent();
        this.error = (err as Error).message;
        console.error('Failed to fetch notifications:', this.error);
      } finally {
        if (operation.isCurrent()) {
        this.loading = false;

        }
      }
    },

    async markAsRead(notificationId: string) {
      const operation = captureAccountOperation();
      this.error = null;
      try {
        const authStore = useAuthStore();
        let csrf = authStore.csrfToken || this.getCsrfFromCookie();
        if (!csrf) {
          await operation.wait(async () => authStore.fetchCsrfToken());
          csrf = authStore.csrfToken || this.getCsrfFromCookie();
        }
        await operation.wait(async () => api.post(`/api/v1/notifications/${notificationId}/read`, null, {
          headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
        }));
        const notification = this.notifications.find((n) => n.id === notificationId);
        if (notification) {
          notification.isRead = true;
        }
      } catch (err: unknown) {
        operation.assertCurrent();
        this.error = (err as Error).message;
      }
    },

    async markAllAsRead() {
      const operation = captureAccountOperation();
      this.error = null;
      // Optimistic update first — clears badge immediately without waiting for API
      this.notifications.forEach((n) => {
        n.isRead = true;
      });
      try {
        const authStore = useAuthStore();
        let csrf = authStore.csrfToken || this.getCsrfFromCookie();
        if (!csrf) {
          await operation.wait(async () => authStore.fetchCsrfToken());
          csrf = authStore.csrfToken || this.getCsrfFromCookie();
        }
        await operation.wait(async () => api.post('/api/v1/notifications/read-all', null, {
          headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
        }));
      } catch (err: unknown) {
        operation.assertCurrent();
        this.error = (err as Error).message;
      }
    },

    async cleanupStale() {
      const operation = captureAccountOperation();
      try {
        const authStore = useAuthStore();
        let csrf = authStore.csrfToken || this.getCsrfFromCookie();
        if (!csrf) {
          await operation.wait(async () => authStore.fetchCsrfToken());
          csrf = authStore.csrfToken || this.getCsrfFromCookie();
        }

        await operation.wait(async () => api.delete('/api/v1/notifications/cleanup', {
          headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
        }));
        // Re-fetch to get the cleaned-up list
        await operation.wait(async () => this.fetchNotifications());
      } catch (err: unknown) {
        operation.assertCurrent();
        const maybeStatus = (err as { response?: { status?: number } })?.response?.status;

        // Retry once with a fresh token when background cleanup races auth token refresh.
        if (maybeStatus === 403) {
          try {
            const authStore = useAuthStore();
            await operation.wait(async () => authStore.fetchCsrfToken());
            const retryCsrf = authStore.csrfToken || this.getCsrfFromCookie();
            await operation.wait(async () => api.delete('/api/v1/notifications/cleanup', {
              headers: retryCsrf ? { 'X-CSRF-Token': retryCsrf } : undefined,
            }));
            await operation.wait(async () => this.fetchNotifications());
            return;
          } catch (retryErr: unknown) {
        operation.assertCurrent();
            console.error('[Notifications] Cleanup retry failed:', (retryErr as Error).message);
            return;
          }
        }

        console.error('[Notifications] Cleanup failed:', (err as Error).message);
      }
    },

    addNotification(notification: Notification) {
      this.notifications.unshift(notification);

      // Play notification sound for every newly received notification.
      void playNotificationSound().catch(() => {
        // Audio not available, silent fail
      });
    },

    removeNotificationByLinkId(linkId: string) {
      // Remove any notification scoped to this link (pending, severed, etc.)
      const initialLength = this.notifications.length;
      this.notifications = this.notifications.filter((n) => {
        const data = n.data as Record<string, unknown> | undefined;
        return (data?.linkId ?? '') !== linkId;
      });

      // Debug log if removed
      if (this.notifications.length < initialLength && import.meta.env.DEV) {
        console.debug(
          `[Notifications] Removed ${initialLength - this.notifications.length} notifications for link: ${linkId}`,
        );
      }
    },

    $reset() {
      this.notifications = [];
      this.loading = false;
      this.error = null;
    },
  },
});

import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { useAuthStore } from 'stores/auth';

export interface AccountLoginAlert {
  id: string;
  sessionId: string;
  deviceName: string;
  ipAddress?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  createdAt: string;
  identityPub?: string | null;
}

export const useSecurityStore = defineStore('security', {
  state: () => ({
    pendingLoginAlerts: [] as AccountLoginAlert[],
    loadingSessionId: null as string | null,
    currentSessionId: null as string | null,
    currentSessionFetchedAt: 0,
  }),

  actions: {
    async refreshCurrentSessionId(force = false) {
      const now = Date.now();
      if (!force && now - this.currentSessionFetchedAt < 30_000) {
        return this.currentSessionId;
      }

      try {
        const response = await api.get('/api/v1/auth/sessions/current');
        const payload = response.data as {
          success?: boolean;
          data?: { sessionId?: string | null };
        };
        this.currentSessionId = payload?.data?.sessionId || null;
      } catch {
        this.currentSessionId = null;
      } finally {
        this.currentSessionFetchedAt = now;
      }

      return this.currentSessionId;
    },

    async pushLoginAlert(alert: AccountLoginAlert) {
      if (this.pendingLoginAlerts.some((a) => a.sessionId === alert.sessionId)) return;

      const currentSessionId = await this.refreshCurrentSessionId();
      if (currentSessionId && alert.sessionId === currentSessionId) {
        return;
      }

      this.pendingLoginAlerts = [...this.pendingLoginAlerts, alert];
    },

    dismissLoginAlert(sessionId: string) {
      this.pendingLoginAlerts = this.pendingLoginAlerts.filter((a) => a.sessionId !== sessionId);
    },

    async revokeRemoteSession(sessionId: string) {
      const authStore = useAuthStore();
      await authStore.fetchCsrfToken();
      await api.delete(`/api/v1/auth/sessions/${sessionId}`, {
        headers: { 'X-CSRF-Token': authStore.csrfToken || '' },
      });
      this.dismissLoginAlert(sessionId);
    },

    async markSessionSafe(sessionId: string, identityPub?: string | null) {
      const authStore = useAuthStore();
      await authStore.fetchCsrfToken();
      await api.post(
        `/api/v1/auth/sessions/${sessionId}/trust`,
        {
          identityPub: identityPub || undefined,
        },
        {
          headers: { 'X-CSRF-Token': authStore.csrfToken || '' },
        },
      );
      this.dismissLoginAlert(sessionId);
    },
  },
});

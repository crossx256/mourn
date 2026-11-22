// src/boot/desktopSessionKeepalive.ts
// Native-only session keep-alive. While the desktop/mobile app is open we ping
// the backend heartbeat endpoint on an interval so the server-side idle timeout
// does not log the user out. This does NOT weaken security: the heartbeat
// still goes through requireAuth (expiry, fingerprint, device-binding checks);
// it only refreshes lastActivityAt. On web this boot is a no-op.
import { defineBoot } from '#q-app';
import { api } from 'boot/axios';
import { useAuthStore } from 'src/stores/auth';
import { isNativeShellActive, isTauriRuntime } from 'src/utils/platform';
import { isSessionAuthFailure } from 'src/utils/apiAuthFailure';
import { captureAccountOperation } from 'src/utils/accountLifecycle';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default defineBoot(({ router }) => {
  if (!isNativeShellActive()) return;

  const authStore = useAuthStore();
  const desktop = isTauriRuntime();

  setInterval(async () => {
    if (!authStore.isLoggedIn) return;
    const operation = captureAccountOperation(authStore);
    const path = '/api/v1/auth/heartbeat';
    try {
      await api.get(path);
    } catch (error) {
      // Leave mobile recovery with the Axios bearer interceptor. A desktop
      // network or permission error isn't evidence that the session expired.
      const response = (error as { response?: { status?: number; data?: unknown } })?.response;
      if (!desktop || !operation.isCurrent() || !isSessionAuthFailure(path, response?.status, response?.data)) return;
      authStore.clearMobileAuthState();
      const route = router.currentRoute.value;
      if (route.meta.requiresAuth) {
        void router.push({ path: '/login', query: { redirect: route.fullPath } });
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
});

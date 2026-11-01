// src/boot/desktopSessionKeepalive.ts
// Native-only session keep-alive. While the desktop/mobile app is open we ping
// the backend heartbeat endpoint on an interval so the server-side idle timeout
// does not log the user out. This does NOT weaken security: the heartbeat
// still goes through requireAuth (expiry, fingerprint, device-binding checks);
// it only refreshes lastActivityAt. On web this boot is a no-op.
import { defineBoot } from '#q-app';
import { api } from 'boot/axios';
import { useAuthStore } from 'src/stores/auth';
import { isNativeShellActive } from 'src/utils/platform';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default defineBoot(() => {
  if (!isNativeShellActive()) return;

  const authStore = useAuthStore();

  setInterval(async () => {
    if (!authStore.isLoggedIn) return;
    try {
      await api.get('/api/v1/auth/heartbeat');
    } catch {
      // Swallow errors: a failed heartbeat must never crash or log the user out.
      // The next successful request (or next interval) will refresh activity.
    }
  }, HEARTBEAT_INTERVAL_MS);
});

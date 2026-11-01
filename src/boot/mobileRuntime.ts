import { defineBoot } from '#q-app';
import { watch } from 'vue';
import { refreshMobileSession } from 'boot/axios';
import { refreshMobileSessionIfDue, isMobileAuthRuntime } from 'src/services/mobileAuth';
import { initializeMobilePush, syncMobilePushRegistration } from 'src/services/mobilePush';
import { mobilePlatform } from 'src/utils/platform';
import { useAuthStore } from 'src/stores/auth';
import { useVaultStore } from 'src/stores/vault';

export default defineBoot(async ({ router }) => {
  if (!isMobileAuthRuntime()) return;
  // Push/session provisioning is OPTIONAL work that must never be able to stop
  // the app from mounting. A rejection here propagates out of Quasar's boot
  // chain, which then never reaches mount() and leaves the user staring at a
  // black screen (that is precisely how the thenable-proxy hang in
  // nativeSecureStorage.ts presented on device). Each step is isolated so a
  // failure degrades to "push unavailable", never to "app does not open".
  await initializeMobilePush(router).catch((error) => {
    console.warn('[Mobile] Push initialization failed', error);
  });
  await applyNativeSystemBars().catch((error) => {
    console.warn('[Mobile] System bar styling failed', error);
  });
  await refreshMobileSessionIfDue(refreshMobileSession).catch((error) => {
    console.warn('[Mobile] Session refresh failed', error);
  });

  const authStore = useAuthStore();
  const vaultStore = useVaultStore();
  watch(
    () => [authStore.isLoggedIn, vaultStore.deviceId] as const,
    ([isLoggedIn, deviceId]) => {
      if (isLoggedIn && deviceId) {
        void syncMobilePushRegistration().catch((error) => {
          console.warn('[Push] Registration synchronization failed', error);
        });
      }
    },
    { immediate: true },
  );

  const { App } = await import('@capacitor/app');
  await App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return;
    void refreshMobileSessionIfDue(refreshMobileSession).catch(() => {});
    if (authStore.isLoggedIn && vaultStore.deviceId) {
      void syncMobilePushRegistration().catch(() => {});
    }
    // Warm the Vault while the app is on screen instead of when the user opens
    // messaging. Establishment is idempotent (it no-ops once initialized and
    // coalesces concurrent callers), so this only does work when a resume found
    // the vault cold — after a re-auth, a reconnect that lost the device token,
    // or a previous attempt that failed. Errors are swallowed: this is a
    // background warm-up, and the messaging page still drives its own attempt.
    if (authStore.isLoggedIn && !vaultStore.isInitialized) {
      void vaultStore.initialize().catch((error) => {
        console.warn('[Mobile] Background vault warm-up failed', error);
      });
    }
  });
});

/**
 * Android system bars.
 *
 * targetSdk 36 means Android 15+ forces edge-to-edge: the WebView draws under the
 * status bar, so the bar's "background" IS our own content and the only thing left
 * to control is the ICON style. Without this the bar kept the system default for a
 * light theme, which on a black app showed up as a pale strip with washed-out
 * icons. Style.Dark = light text for dark backgrounds.
 *
 * setBackgroundColor is ignored under enforced edge-to-edge (and warns on some
 * ROMs), so it is best-effort and can never fail the boot.
 */
async function applyNativeSystemBars(): Promise<void> {
  if (mobilePlatform() !== 'android') return;
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Dark });
  await StatusBar.setBackgroundColor({ color: '#000000' }).catch(() => {});
  await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
}

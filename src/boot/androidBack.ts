import { defineBoot } from '#q-app';
import { handleMobileBack } from 'src/composables/useAndroidBack';
import { isCapacitorRuntime, mobilePlatform } from 'src/utils/platform';

/**
 * Android system back (hardware button AND the swipe gesture).
 *
 * Nothing handled this before, so back at any point in the app fell through to
 * Capacitor's default and left the app — including out of a full-screen
 * conversation, which is the one place every chat app treats back as "return to
 * the list".
 *
 * Capacitor stops applying its own default the moment a `backButton` listener
 * exists, so this file owns every case, last resort included:
 *   1. a surface that registered a handler (open conversation, open drawer …)
 *   2. otherwise go up through the app's own history
 *   3. only then leave the app
 */
export default defineBoot(({ router }) => {
  if (!isCapacitorRuntime() || mobilePlatform() !== 'android') return;

  void import('@capacitor/app')
    .then(({ App }) =>
      App.addListener('backButton', () => {
        if (handleMobileBack()) return;

        const historyState = window.history.state as { back?: string } | null;
        if (historyState?.back) {
          router.back();
          return;
        }

        void App.exitApp();
      }),
    )
    .catch((error) => {
      console.warn('[Back] Android back listener unavailable', error);
    });
});

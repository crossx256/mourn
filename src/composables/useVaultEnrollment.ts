/**
 * Vault device enrollment prompt.
 *
 * WHY THIS EXISTS
 * Device private keys live in OS secure storage (Android Keystore-backed
 * EncryptedSharedPreferences on mobile — see services/nativeSecureStorage.ts).
 * That master key is destroyed by the OS when the device lock screen is removed,
 * credentials are reset, or the app is installed fresh. When it happens the stored
 * ciphertext is permanently unreadable, so the client generates a NEW device
 * identity and the server answers `403 CURRENT_PASSWORD_REQUIRED` ("Current password
 * is required to enroll a new device").
 *
 * The vault store then sets `connectionError = 'vault_device_registration_failed'`
 * and returns — and because session restore initialises the vault WITHOUT a
 * password, that used to be the end of it: the composer rendered normally with a
 * permanently dead send button and an empty message list, with the reason only in
 * the console. To the user, messaging was simply broken.
 *
 * Recovery is re-enrollment with the account password (MOBILE.md), so this module
 * owns the one prompt for it: it is used by the chat composer's locked-state strip
 * and by the shell's one-shot boot check.
 *
 * Quasar note: dialogs/notifications must go through `$q` (`useQuasar()`), which
 * needs the component injection context — a module-level `import { Dialog } from
 * 'quasar'` resolves to a singleton without `.create` in some chunks
 * (`TypeError: Dialog.create is not a function`). This is a real composable called
 * from a component's setup for exactly that reason.
 */

import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import { hapticTap, hapticSuccess } from 'src/composables/useHaptics';
import { useAuthStore } from 'src/stores/auth';
import { useVaultStore } from 'src/stores/vault';

/** True while a prompt is on screen — guards against double-submit. */
const enrolling = ref(false);

export function useVaultEnrollment() {
  const $q = useQuasar();
  const vaultStore = useVaultStore();
  const authStore = useAuthStore();

  /**
   * True when the vault is unusable specifically because this device could not be
   * enrolled. Other `connectionError` values (network, transport) are not fixed by a
   * password, so they must not trigger this prompt.
   */
  const vaultEnrollmentNeeded = computed(
    () =>
      !vaultStore.isInitialized &&
      Boolean(vaultStore.connectionError) &&
      /registration_failed/.test(String(vaultStore.connectionError)),
  );

  /**
   * Ask for the account password, re-enroll this device, and return whether secure
   * messaging came back. Resolves false when the user cancels.
   */
  async function promptVaultEnrollment(): Promise<boolean> {
    if (enrolling.value) return false;

    void hapticTap();
    enrolling.value = true;
    try {
      const password = await new Promise<string | null>((resolve) => {
        $q.dialog({
          title: 'unlock secure messaging',
          message:
            'This device needs to be re-enrolled for encrypted messaging. ' +
            'Enter your account password — it is used once and never stored.',
          prompt: {
            model: '',
            type: 'password',
            isValid: (value: string) => value.length > 0,
          },
          cancel: true,
          persistent: true,
        })
          .onOk((value: string) => resolve(value))
          .onCancel(() => resolve(null))
          .onDismiss(() => resolve(null));
      });
      if (!password) return false;

      // establishVaultAfterLogin() re-runs initialize() with the password and waits
      // (bounded) for registration + the WebSocket handshake.
      await authStore.establishVaultAfterLogin(password);

      if (vaultStore.isInitialized) {
        void hapticSuccess();
        $q.notify({ type: 'positive', message: 'Secure messaging unlocked' });
        sessionStorage.removeItem('vaultEnrollmentPrompted');
        return true;
      }

      const code = vaultStore.enrollmentErrorCode;
      if (code === 'RATE_LIMITED') {
        const hint = vaultStore.enrollmentRetryAfter
          ? ` Wait ${vaultStore.enrollmentRetryAfter.replace(' seconds', 's')}.`
          : ' Wait a few minutes.';
        $q.notify({
          type: 'warning',
          message: `Too many enrollment attempts.${hint}`,
          timeout: 6000,
        });
      } else if (code === 'CURRENT_PASSWORD_REQUIRED') {
        $q.notify({ type: 'negative', message: 'Incorrect password. Try again.' });
      } else if (code === 'DEVICE_LIMIT') {
        $q.notify({ type: 'negative', message: 'Device limit reached. Remove a device first.' });
      } else {
        $q.notify({
          type: 'negative',
          message: `Enrollment failed${code ? ` (${code})` : ''}. Try again in a moment.`,
        });
      }
      return false;
    } catch (err) {
      console.error('[VaultEnrollment] failed', err);
      $q.notify({ type: 'negative', message: 'Enrollment failed. Try again in a moment.' });
      return false;
    } finally {
      enrolling.value = false;
    }
  }

  /**
   * Shell boot hook: if messaging is locked, offer the prompt once per app session.
   * Delayed so the prompt does not race the first route's data loads and the user
   * sees the app before a dialog covers it.
   */
  function checkVaultEnrollmentOnBoot(delayMs = 2500): void {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('vaultEnrollmentPrompted') === 'true') return;
    window.setTimeout(() => {
      if (!vaultEnrollmentNeeded.value) return;
      // Rate-limited: a password will not help and another attempt just pushes the
      // window further out. Don't auto-pop the dialog; the chat strip still shows
      // the reason and a manual tap surfaces the wait message.
      if (vaultStore.enrollmentErrorCode === 'RATE_LIMITED') return;
      sessionStorage.setItem('vaultEnrollmentPrompted', 'true');
      void promptVaultEnrollment();
    }, delayMs);
  }

  return { enrolling, vaultEnrollmentNeeded, promptVaultEnrollment, checkVaultEnrollmentOnBoot };
}

/**
 * L18 (audit): the offline-authorization probe was fired as
 * `void resolveOfflineAuthorized()` with no catch in ArchiveShowPage,
 * ArchivesPage and GraveyardPage. `isOfflineModeAuthorized()` reads the OS
 * keychain through dynamic imports and can reject (account-store load failure,
 * keychain bridge unavailable). An unhandled rejection from onMounted becomes an
 * app-level error: on the graveyard page it hits `onErrorCaptured`, which flips
 * the 3D view to its "WebGL unavailable" fallback; on the archives page it
 * aborts the boot loader before `load()` runs.
 *
 * Being un-authorized is a normal state, not an error. This wrapper turns a
 * rejection into a denial so the primary page load always runs.
 */
type OfflineModeState = { authorized: boolean };

export async function resolveOfflineAuthorizedSafely(
  authorize: () => Promise<OfflineModeState>,
  setAuthorized: (authorized: boolean) => void,
): Promise<boolean> {
  try {
    const state = await authorize();
    setAuthorized(state.authorized);
    return state.authorized;
  } catch {
    // Deny on any failure: never grant offline on an unverifiable path, and
    // never let the probe's rejection mask the page's own load.
    setAuthorized(false);
    return false;
  }
}

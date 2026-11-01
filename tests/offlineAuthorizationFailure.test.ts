import { describe, expect, it } from 'vitest';
import { resolveOfflineAuthorizedSafely } from '../src/utils/offlineAuthorization';

/**
 * L18 (audit): the offline-authorization probe on the archive, archives and
 * graveyard pages was fired as `void resolveOfflineAuthorized()` with no catch.
 * `isOfflineModeAuthorized()` reads the OS keychain through a dynamic import
 * and can reject (store load failure, keychain bridge). An unhandled rejection
 * from onMounted surfaces as an app-level error — on the graveyard page it hit
 * the page's `onErrorCaptured`, which flips the 3D view to its "WebGL
 * unavailable" fallback, and on the archives page it aborted the boot loader
 * before `load()` ran.
 *
 * Being un-authorized is a normal state, not an error: the badges/controls
 * stay hidden and the caller's primary load must still run.
 */
describe('L18 — an offline-authorization failure is a denial, not a crash', () => {
  it('resolves false and leaves the surface hidden when the probe rejects', async () => {
    const seen: boolean[] = [];
    const result = await resolveOfflineAuthorizedSafely(
      async () => {
        throw new Error('keychain unavailable');
      },
      (value) => seen.push(value),
    );
    expect(result).toBe(false);
    expect(seen).toEqual([false]);
  });

  it('still reports a real authorization', async () => {
    const seen: boolean[] = [];
    const result = await resolveOfflineAuthorizedSafely(async () => ({ authorized: true }), (value) =>
      seen.push(value),
    );
    expect(result).toBe(true);
    expect(seen).toEqual([true]);
  });

  it('never leaves a rejection unhandled (the page awaits it)', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const page = resolveOfflineAuthorizedSafely(async () => ({ authorized: false }), () => undefined);
      await page;
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

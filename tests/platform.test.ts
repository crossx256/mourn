// tests/platform.test.ts
// Guards the ONE platform axis (src/utils/platform.ts) that every desktop/mobile
// branch in the app now hangs off. The failure mode this test exists to prevent
// is a mobile build that looks native but is detected as web — or the reverse: a
// WEB build that suddenly renders the Vault/messaging surfaces.
//
// Run: bunx vitest run tests/platform.test.ts

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MOURN_PLATFORM,
  isWebBuild,
  isDesktopBuild,
  isMobileBuild,
  isNativeBuild,
  isTauriRuntime,
  isCapacitorRuntime,
  isNativeShellActive,
  nativeShell,
  mobilePlatform,
} from '../src/utils/platform';
import {
  backendForShell,
  getSecureStorage,
  isSecureStorageAvailable,
  MOBILE_KEY_PREFIX,
  mobileSlotName,
} from '../src/services/nativeSecureStorage';

interface FakeCapacitor {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

interface FakeWindow {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  Capacitor?: FakeCapacitor;
  capacitor?: unknown;
  location?: { protocol?: string };
}

function setWindow(value: FakeWindow | undefined): void {
  if (value === undefined) {
    delete (globalThis as { window?: unknown }).window;
    return;
  }
  (globalThis as { window?: unknown }).window = value;
}

const TAURI_WINDOW: FakeWindow = { __TAURI_INTERNALS__: {} };
const CAPACITOR_ANDROID: FakeWindow = {
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
};
const CAPACITOR_IOS: FakeWindow = {
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
};
/** A Capacitor bundle running in a plain browser preview: imports exist, no bridge. */
const CAPACITOR_WEB_PREVIEW: FakeWindow = {
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
};

afterEach(() => setWindow(undefined));

describe('platform axis (compile-time targets)', () => {
  it('falls back to the web target when no build define is present', () => {
    // vitest runs without quasar.config.ts rawDefine, which is exactly the
    // "unknown host" case the fallback exists for.
    expect(MOURN_PLATFORM).toBe('web');
    expect(isWebBuild).toBe(true);
    expect(isDesktopBuild).toBe(false);
    expect(isMobileBuild).toBe(false);
    expect(isNativeBuild).toBe(false);
  });

  it('never reports a native shell active in a web build, even with a bridge attached', () => {
    // SECURITY: the website must not render Vault/messaging even if something
    // injects Capacitor/Tauri globals into the page.
    for (const fake of [TAURI_WINDOW, CAPACITOR_ANDROID, CAPACITOR_IOS]) {
      setWindow(fake);
      expect(isNativeShellActive()).toBe(false);
    }
  });

  it('reports no secure storage on web (no plaintext fallback path exists)', () => {
    setWindow(CAPACITOR_ANDROID); // bridge present, but this is a web build
    expect(getSecureStorage()).toBe(null);
    expect(isSecureStorageAvailable()).toBe(false);
  });
});

describe('native runtime detection', () => {
  it('detects the Tauri shell from the injected internals', () => {
    setWindow(TAURI_WINDOW);
    expect(isTauriRuntime()).toBe(true);
    expect(isCapacitorRuntime()).toBe(false);
    expect(nativeShell()).toBe('tauri');
  });

  it('detects the Capacitor shell and its platform', () => {
    setWindow(CAPACITOR_ANDROID);
    expect(isCapacitorRuntime()).toBe(true);
    expect(isTauriRuntime()).toBe(false);
    expect(nativeShell()).toBe('capacitor');
    expect(mobilePlatform()).toBe('android');

    setWindow(CAPACITOR_IOS);
    expect(mobilePlatform()).toBe('ios');
  });

  it('does NOT treat a browser Capacitor preview as a native device', () => {
    // This is the fail-closed check: the plugin has a web implementation, and
    // falling through to it would put device private keys in web storage.
    setWindow(CAPACITOR_WEB_PREVIEW);
    expect(isCapacitorRuntime()).toBe(false);
    expect(nativeShell()).toBe('none');
    expect(getSecureStorage()).toBe(null);
  });

  it('returns none with no window at all (SSR)', () => {
    setWindow(undefined);
    expect(nativeShell()).toBe('none');
    expect(mobilePlatform()).toBe('other');
    expect(isTauriRuntime()).toBe(false);
    expect(isCapacitorRuntime()).toBe(false);
  });

  it('maps each (build, shell) pair to the right secure-storage backend', () => {
    // The mapping is pure, so it is testable without a device: a native BUILD +
    // live bridge selects the platform store, anything else selects nothing.
    expect(backendForShell('tauri', true)?.name).toBe('tauri');
    expect(backendForShell('capacitor', true)?.name).toBe('capacitor');
    expect(backendForShell('none', true)).toBe(null);
    expect(backendForShell('tauri', false)).toBe(null);
    expect(backendForShell('capacitor', false)).toBe(null);
    expect(backendForShell('none', false)).toBe(null);
  });

  it('namespaces every mobile secret so it cannot collide with other slots', () => {
    // Every mobile secret goes through the same plugin as one flat keyspace, so
    // the `mourn.` prefix is what keeps credential slots, key slots and the
    // offline-cache master key from colliding — and it must be idempotent.
    expect(mobileSlotName('credential:krul')).toBe(`${MOBILE_KEY_PREFIX}credential:krul`);
    expect(mobileSlotName('offline_vault_key')).toBe(`${MOBILE_KEY_PREFIX}offline_vault_key`);
    expect(mobileSlotName(`${MOBILE_KEY_PREFIX}credential:krul`)).toBe(
      `${MOBILE_KEY_PREFIX}credential:krul`,
    );
  });
});

/**
 * Records every call the mocked plugin handle receives, so the tests below can
 * assert both "did not hang" and "used the namespaced slot".
 */
const secureStorageCalls = vi.hoisted(() => [] as { method: string; args: unknown[] }[]);

// A real Capacitor plugin handle is a Proxy whose EVERY property access returns
// a function — `then` included. Resolving a promise to one makes the runtime
// call that fake `then()`, and Capacitor rejects it on a promise nobody holds,
// so the awaiting caller HANGS FOREVER rather than throwing. Quasar's boot
// chain then never completes and the Android app mounts nothing (permanent
// black screen). This mock is the exact shape that caused it — see
// src/services/nativeSecureStorage.ts.
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'then') {
          return () =>
            Promise.reject(new Error('"SecureStorage.then()" is not implemented on android'));
        }
        return (...args: unknown[]) => {
          secureStorageCalls.push({ method: String(prop), args });
          if (prop === 'keys') return Promise.resolve(['mourn.a', 'not-ours.b']);
          if (prop === 'getItem') return Promise.resolve('stored-value');
          return Promise.resolve();
        };
      },
    },
  ),
}));

describe('capacitor secure-storage glue (thenable-proxy guard)', () => {
  const NEVER_SETTLED = Symbol('never-settled');

  it('does not hang when the plugin handle is a thenable proxy', async () => {
    const backend = backendForShell('capacitor', true);
    expect(backend?.name).toBe('capacitor');

    const outcome = await Promise.race([
      backend!.set('krul', 'token'),
      new Promise((resolve) => setTimeout(() => resolve(NEVER_SETTLED), 1_000)),
    ]);

    // Pre-fix this never settled: `await plugin()` assimilated the proxy as a
    // thenable, the fake then() rejected into the void and the caller waited
    // forever. Anything but NEVER_SETTLED proves the promise actually resolved.
    expect(outcome).not.toBe(NEVER_SETTLED);
    expect(secureStorageCalls).toContainEqual({ method: 'setItem', args: ['mourn.krul', 'token'] });
  });

  it('routes get / remove / keys through the namespaced slots', async () => {
    const backend = backendForShell('capacitor', true)!;

    await expect(backend.get('krul')).resolves.toBe('stored-value');
    await expect(backend.remove('krul')).resolves.toBeUndefined();
    // keys() must expose only this app's slots, unprefixed for the caller.
    await expect(backend.keys()).resolves.toEqual(['mourn.a']);

    expect(secureStorageCalls).toContainEqual({ method: 'getItem', args: ['mourn.krul'] });
    expect(secureStorageCalls).toContainEqual({ method: 'removeItem', args: ['mourn.krul'] });
    expect(secureStorageCalls).toContainEqual({ method: 'keys', args: [] });
  });
});

/**
 * Native secure storage for SECRET material — device private keys, account
 * credentials, the offline-vault master key.
 *
 * Backends
 *   tauri      Rust `vault_key_set|get|remove` → OS keychain
 *              (Windows Credential Manager / libsecret).
 *   capacitor  `@aparajita/capacitor-secure-storage` → Android Keystore-backed
 *              EncryptedSharedPreferences / iOS Keychain.
 *   (none)     The public website. There is deliberately NO plaintext fallback:
 *              a caller that receives `null` from `getSecureStorage()` must
 *              disable the feature, never write the secret into
 *              localStorage / plain IndexedDB.
 *
 * WHY THE GUARD IS STRICT
 * `@aparajita/capacitor-secure-storage` has a browser implementation, and
 * Capacitor plugins are importable in a plain `quasar dev` browser preview. Two
 * independent conditions must BOTH hold before any secret can be written:
 *   1. the bundle was built for a native shell (`isNativeBuild`) — the website
 *      has no secret store and must never grow one, and
 *   2. the matching native bridge is actually attached (`isTauriRuntime()` /
 *      `isCapacitorRuntime()`, the latter requiring a real native platform, not
 *      Capacitor's web fallback).
 * Anything else returns `null`, which every caller must read as "feature
 * unavailable" — never as "use something else". Both halves are covered by
 * tests/platform.test.ts.
 *
 * ANDROID KEYSTORE GOTCHA (design constraint, not a bug)
 * EncryptedSharedPreferences keys are backed by a Keystore master key that the
 * OS destroys when the user removes their device lock screen / resets
 * credentials. When that happens the stored ciphertext becomes permanently
 * unreadable. Mourn's recovery path is re-enrollment (`POST /vault/devices`),
 * NOT a fallback to weaker storage — see MOBILE.md.
 */

import { isNativeBuild, nativeShell } from 'src/utils/platform';
import type { NativeShell } from 'src/utils/platform';

export type SecureStorageBackendName = 'tauri' | 'capacitor';

export interface SecureStorageBackend {
  readonly name: SecureStorageBackendName;
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  /** Enumerate stored keys (optionally filtered by prefix). */
  keys(prefix?: string): Promise<string[]>;
}

/** Prefixed so mobile credential slots can never collide with key slots. */
export const MOBILE_KEY_PREFIX = 'mourn.';

/**
 * Fully-qualified mobile slot name for a logical key. Idempotent, so a caller
 * that already prefixed a key (e.g. when enumerating) cannot double-prefix it.
 */
export function mobileSlotName(key: string): string {
  return key.startsWith(MOBILE_KEY_PREFIX) ? key : `${MOBILE_KEY_PREFIX}${key}`;
}

class TauriSecureStorage implements SecureStorageBackend {
  readonly name = 'tauri' as const;

  async set(key: string, value: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('vault_key_set', { keyName: key, value });
  }

  async get(key: string): Promise<string | null> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('vault_key_get', { keyName: key });
  }

  async remove(key: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('vault_key_remove', { keyName: key });
  }

  keys(): Promise<string[]> {
    // The desktop keeps its own credential index in Rust (`secure_store_list`)
    // and never needed to enumerate the generic keychain surface, so no such
    // command exists. Failing loudly beats pretending the store is empty.
    return Promise.reject(new Error('tauri keychain is not enumerable'));
  }
}

class CapacitorSecureStorage implements SecureStorageBackend {
  readonly name = 'capacitor' as const;

  /**
   * Resolves to a holder object — never to the plugin handle itself.
   *
   * `@aparajita/capacitor-secure-storage` exports a Capacitor JS *proxy* for
   * which every property access returns a function, `then` included. A promise
   * that resolves to such a proxy is assimilated as a thenable: the runtime
   * calls the fake `then()`, Capacitor rejects with
   * `"SecureStorage.then()" is not implemented on android`, and because that
   * rejection lands on a promise nobody holds, the awaiting caller never
   * settles at all — it hangs instead of failing. A boot-time `await` on it
   * therefore never resolves, the Quasar boot chain never completes, the app
   * never mounts and the user sees a black screen (with only an
   * unhandled-rejection line in logcat). Resolving to `{ api }` keeps the
   * thenable proxy out of the promise resolution path entirely.
   */
  private async plugin() {
    const mod = await import('@aparajita/capacitor-secure-storage');
    return { api: mod.SecureStorage };
  }

  private prefixed(key: string): string {
    return mobileSlotName(key);
  }

  async set(key: string, value: string): Promise<void> {
    const { api } = await this.plugin();
    await api.setItem(this.prefixed(key), value);
  }

  async get(key: string): Promise<string | null> {
    const { api } = await this.plugin();
    return api.getItem(this.prefixed(key));
  }

  async remove(key: string): Promise<void> {
    const { api } = await this.plugin();
    await api.removeItem(this.prefixed(key));
  }

  async keys(prefix = ''): Promise<string[]> {
    const { api } = await this.plugin();
    const full = this.prefixed(prefix);
    const all = await api.keys();
    return all.filter((k) => k.startsWith(full));
  }
}

const tauriBackend = new TauriSecureStorage();
const capacitorBackend = new CapacitorSecureStorage();

/**
 * The secure-storage backend for the current runtime, or `null` when none is
 * available (website, SSR, or a Capacitor build running without its native
 * bridge). Callers MUST treat `null` as "feature unavailable" — never as "use
 * something else".
 */
export function getSecureStorage(): SecureStorageBackend | null {
  return backendForShell(nativeShell());
}

/**
 * The backend for a given (build target, attached shell) pair. Pure so the
 * mapping is unit-testable without a device: the fail-closed rule is that a
 * non-native BUILD never yields a backend, whatever shell globals are present.
 *
 * @param shell attached shell, as reported by `nativeShell()`
 * @param nativeBuild whether the bundle was built for a native target
 */
export function backendForShell(
  shell: NativeShell,
  nativeBuild: boolean = isNativeBuild,
): SecureStorageBackend | null {
  // Condition 1: the BUILD must be a native one. A web bundle keeps zero
  // secrets, whatever globals happen to be injected into the page.
  if (!nativeBuild) return null;
  // Condition 2: the matching bridge must be live.
  if (shell === 'tauri') return tauriBackend;
  if (shell === 'capacitor') return capacitorBackend;
  return null;
}

/** Convenience predicate for UI/feature gating. */
export function isSecureStorageAvailable(): boolean {
  return getSecureStorage() !== null;
}

/**
 * Strip the mobile key prefix from a slot name returned by `keys()` so callers
 * see the same identifiers they stored (e.g. `credential:krul`).
 */
export function unprefixSecureKey(key: string): string {
  return key.startsWith(MOBILE_KEY_PREFIX) ? key.slice(MOBILE_KEY_PREFIX.length) : key;
}

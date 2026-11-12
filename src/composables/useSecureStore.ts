export interface StoredCredentials {
  username: string;
  password?: string;
  lastUsed: number;
  stayLoggedIn?: boolean;
}

import { getSecureStorage } from 'src/services/nativeSecureStorage';
import { isCapacitorRuntime, isTauriRuntime } from 'src/utils/platform';

/**
 * Native-only credential persistence ("stay logged in"). Credentials are stored
 * in the platform's hardware-backed secret store — never a plaintext file and
 * never IndexedDB:
 *
 *   desktop (Tauri)  Rust `secure_store_*` commands. The Rust side keeps the
 *                    password in the OS keychain and only a meta-only index
 *                    (username + flags) on disk.
 *   mobile           `@aparajita/capacitor-secure-storage` slots named
 *                    `credential:<username>` (Android Keystore-backed
 *                    EncryptedSharedPreferences / iOS Keychain).
 *   web              no-op. The website deliberately cannot persist a password.
 *
 * The Capacitor path stores one JSON record per account under a distinct slot
 * instead of one blob for all accounts, so an individual account can be removed
 * without rewriting the others (mirrors `secure_store_remove { username }`).
 */
const CAPACITOR_CREDENTIAL_PREFIX = 'credential:';

export function useSecureStore() {
  const tauriInvoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  };

  function isTauri(): boolean {
    return isTauriRuntime();
  }

  function readMobileRecord(raw: string | null, username: string): StoredCredentials | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
      return {
        username: parsed.username || username,
        password: typeof parsed.password === 'string' ? parsed.password : undefined,
        lastUsed: typeof parsed.lastUsed === 'number' ? parsed.lastUsed : Date.now(),
        stayLoggedIn: !!parsed.stayLoggedIn,
      };
    } catch {
      // A corrupt slot must behave like a miss, never like valid credentials.
      return undefined;
    }
  }

  async function saveCredentials(creds: {
    username: string;
    password?: string;
    stayLoggedIn?: boolean;
  }): Promise<void> {
    if (!creds.password) return;

    try {
      if (isTauri()) {
        await tauriInvoke('secure_store_upsert', {
          username: creds.username,
          password: creds.password,
          stayLoggedIn: !!creds.stayLoggedIn,
        });
        return;
      }

      if (isCapacitorRuntime()) {
        const storage = getSecureStorage();
        if (!storage) return;
        const record: StoredCredentials = {
          username: creds.username,
          password: creds.password,
          lastUsed: Date.now(),
          stayLoggedIn: !!creds.stayLoggedIn,
        };
        await storage.set(`${CAPACITOR_CREDENTIAL_PREFIX}${creds.username}`, JSON.stringify(record));
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[SecureStore] saveCredentials failed', err);
      }
    }
  }

  async function getCredentials(username: string): Promise<StoredCredentials | undefined> {
    try {
      if (isTauri()) {
        const result = await tauriInvoke<StoredCredentials | null>('secure_store_get', { username });
        return result ?? undefined;
      }

      if (isCapacitorRuntime()) {
        const storage = getSecureStorage();
        if (!storage) return undefined;
        const raw = await storage.get(`${CAPACITOR_CREDENTIAL_PREFIX}${username}`);
        return readMobileRecord(raw, username);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[SecureStore] getCredentials failed', err);
      }
    }
    return undefined;
  }

  /**
   * Every stored account record, newest-used first. Backs desktop auto-login
   * (`autoLogin` picks the stay-logged-in entries and retries them in order).
   * Returns [] on web, and [] on any store failure — a broken secret store must
   * never look like "an account was found".
   */
  async function listCredentials(): Promise<StoredCredentials[]> {
    try {
      if (isTauri()) {
        const stored = await tauriInvoke<
          Array<{ username: string; stayLoggedIn?: boolean; lastUsed?: number }>
        >('secure_store_list');
        return stored
          .map((entry) => ({
            username: entry.username,
            lastUsed: typeof entry.lastUsed === 'number' ? entry.lastUsed : 0,
            stayLoggedIn: !!entry.stayLoggedIn,
          }))
          .sort((a, b) => b.lastUsed - a.lastUsed);
      }

      if (isCapacitorRuntime()) {
        const storage = getSecureStorage();
        if (!storage) return [];
        const keys = await storage.keys(CAPACITOR_CREDENTIAL_PREFIX);
        const records: StoredCredentials[] = [];
        for (const key of keys) {
          const username = key.slice(key.indexOf(CAPACITOR_CREDENTIAL_PREFIX) + CAPACITOR_CREDENTIAL_PREFIX.length);
          const raw = await storage.get(`${CAPACITOR_CREDENTIAL_PREFIX}${username}`);
          const record = readMobileRecord(raw, username);
          if (record) records.push(record);
        }
        return records.sort((a, b) => b.lastUsed - a.lastUsed);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[SecureStore] listCredentials failed', err);
      }
    }
    return [];
  }

  async function removeCredentials(username: string): Promise<void> {
    try {
      if (isTauri()) {
        await tauriInvoke('secure_store_remove', { username });
        return;
      }

      if (isCapacitorRuntime()) {
        const storage = getSecureStorage();
        if (!storage) throw new Error('Secure credential storage is unavailable. Saved credentials were not removed; retry local account removal.');
        await storage.remove(`${CAPACITOR_CREDENTIAL_PREFIX}${username}`);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[SecureStore] removeCredentials failed', err);
      }
      // Deletion is an explicit privacy action: callers must report failure and
      // retain the saved-account entry so the user can retry cleanup.
      throw err;
    }
  }

  return {
    saveCredentials,
    getCredentials,
    listCredentials,
    removeCredentials,
  };
}

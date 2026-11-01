/**
 * Offline Vault — secure, app-scoped storage for downloadable Archives
 * and the Graveyard Galaxy cache (NATIVE SHELLS ONLY: desktop + mobile;
 * zero web surface).
 *
 * Threat model:
 *   - A malicious reader with filesystem/IndexedDB access must NOT recover
 *     plaintext archive/graveyard content.
 *   - The encryption key is stored ONLY in OS secure storage under a fixed,
 *     app-scoped slot (`offline_vault_key`) — cryptographically INDEPENDENT of
 *     account credentials (`secure_store_*`), so the offline cache never rides
 *     on the account keychain lifecycle.
 *   - Ciphertext + nonce + metadata live in IndexedDB (single origin, the
 *     browser/webview storage sandbox). Plaintext exists only in memory while
 *     the app is open.
 *
 * Key separation rationale (Option 2 over Option 1): reusing the per-username
 * credential key would tie offline archives to a specific login. A separate
 * app-scoped key means account logout / credential rotation / keychain cleanup
 * cannot orphan or re-expose the offline vault.
 *
 * NATIVE ONLY: every function returns disabled/no-op in a non-native runtime
 * (i.e. the public web SPA/SSR). Nothing in this module touches the DOM,
 * IndexedDB, or the keychain from the browser.
 *
 * Key slots per platform (both map to the same conceptual slot, but the
 * DESKTOP keeps its own Rust commands so existing installs do not lose the key
 * that already encrypts their on-disk cache):
 *   desktop  Rust `offline_vault_get_key` / `offline_vault_set_key`
 *   mobile   secure storage slot `offline_vault_key` (Keystore / Keychain)
 */

import sodium from 'libsodium-wrappers';
import { get, set, del, update, keys } from 'idb-keyval';
import { MAX_RATCHET_RECEIPTS, type RatchetState } from './types';
import { DoubleRatchet } from './ratchet';
import { getSecureStorage } from 'src/services/nativeSecureStorage';
import { isCapacitorRuntime } from 'src/utils/platform';

/** IndexedDB namespace prefixes so offline blobs never collide with vault keys. */
const ARCHIVE_NS = 'offline_archive';
const GRAVEYARD_NS = 'offline_graveyard';
const DASHBOARD_NS = 'offline_dashboard';
const MESSAGING_NS = 'offline_messaging';

export type OfflineVaultKind = 'archive' | 'graveyard' | 'dashboard' | 'messaging';

export interface OfflineBlobContext {
  kind: string;
  id: string;
  accountId?: string;
}

export interface EncryptedBlob {
  /** Absent on legacy blobs, whose identity/metadata was not authenticated. */
  version?: 2;
  /** Base64 XChaCha20-Poly1305 ciphertext. */
  ciphertextB64: string;
  /** Base64 24-byte nonce. */
  nonceB64: string;
  /** Opaque app metadata (kept outside ciphertext for cheap listing). */
  meta?: Record<string, string>;
  /** Saved-at epoch ms, for TTL / pruning. */
  savedAt: number;
}

let keyCache: Uint8Array | null = null;
let keyPromise: Promise<Uint8Array | undefined> | null = null;
let keyGeneration = 0;

/**
 * True when the current runtime has a hardware-backed secret store attached:
 * the Tauri OS keychain on desktop, the Keystore/Keychain on mobile. The
 * website has neither, and every offline-vault entry point is disabled there.
 */
function isOfflineVaultRuntime(): boolean {
  return getSecureStorage() !== null;
}

/** Mobile-only secure-storage slot for the offline-cache master key. */
const MOBILE_OFFLINE_KEY_SLOT = 'offline_vault_key';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

function namespaceFor(kind: OfflineVaultKind): string {
  switch (kind) {
    case 'archive':
      return ARCHIVE_NS;
    case 'dashboard':
      return DASHBOARD_NS;
    case 'messaging':
      return MESSAGING_NS;
    default:
      return GRAVEYARD_NS;
  }
}

/**
 * Read the app-scoped master key from OS secure storage. Returns undefined when
 * the slot is empty (never throws for a miss). Native runtimes only.
 */
async function readKeyFromKeychain(): Promise<Uint8Array | undefined> {
  if (!isOfflineVaultRuntime()) return undefined;
  if (isCapacitorRuntime()) {
    const storage = getSecureStorage();
    const stored = await storage?.get(MOBILE_OFFLINE_KEY_SLOT);
    if (stored === null || stored === undefined) return undefined;
    return sodium.from_base64(stored);
  }
  const b64 = await invoke<string | null>('offline_vault_get_key');
  if (b64 === null) return undefined;
  return sodium.from_base64(b64);
}

/**
 * Persist a fresh master key into the app-scoped keychain slot. Desktop-only;
 * a no-op (resolved) on web.
 */
async function writeKeyToKeychain(key: Uint8Array): Promise<void> {
  if (!isOfflineVaultRuntime()) throw new Error('Offline secure storage unavailable');
  if (isCapacitorRuntime()) {
    const storage = getSecureStorage();
    await storage?.set(MOBILE_OFFLINE_KEY_SLOT, sodium.to_base64(key));
    return;
  }
  await invoke('offline_vault_set_key', {
    keyB64: sodium.to_base64(key),
  });
}

/**
 * Get the app-scoped vault master key, creating + persisting it on first use
 * (libsodium CSPRNG). Result is cached for the session. Returns undefined only
 * on a non-desktop runtime (callers must already have gated on `enabled`).
 */
export async function getOrCreateOfflineKey(): Promise<Uint8Array | undefined> {
  if (!isOfflineVaultRuntime()) return undefined;
  if (keyCache) return keyCache.slice();
  const generation = keyGeneration;
  if (!keyPromise) {
    keyPromise = (async () => {
      await sodium.ready;
      const existing = await readKeyFromKeychain();
      if (existing !== undefined && existing.length !== 32) {
        throw new Error('Corrupt offline vault key; refusing to overwrite it');
      }
      const key = existing ?? sodium.randombytes_buf(32);
      if (existing === undefined) await writeKeyToKeychain(key);
      return key;
    })();
  }
  const pending = keyPromise;
  try {
    const key = await pending;
    if (generation !== keyGeneration) throw new Error('Offline key initialization invalidated');
    if (key) keyCache = key.slice();
    return key?.slice();
  } finally {
    if (keyPromise === pending) keyPromise = null;
  }
}

/** Force-refresh the in-memory key cache (e.g. key was rotated). */
export function resetOfflineKeyCache(): void {
  keyCache?.fill(0);
  keyCache = null;
  keyGeneration += 1;
  // Keep a pending creation single-flight even across reset/account changes.
}

/** True only on a native runtime — the offline vault is a no-op on web. */
export function isOfflineVaultEnabled(): boolean {
  return isOfflineVaultRuntime();
}

export type OfflineModeState =
  | { authorized: true }
  | { authorized: false; reason: 'no-desktop' | 'not-authed' | 'not-stay-logged-in' };

/**
 * SECURITY GATE (krul, 2026-08): offline mode MAY only be used when the user
 * is (a) on the desktop runtime, (b) actually authenticated on THIS device,
 * AND (c) has chosen "stay logged in" (i.e. saved credentials exist in the OS
 * keychain for the current account). A random install that has never signed in
 * (or signed in without persistence) must NOT be able to read any offline
 * vault data. Fail-closed: any miss → not authorized.
 *
 * Because "stay logged in" is an OS-keychain credential read, this helper is
 * ASYNC. Every place that actually SERVES decrypted offline cache content
 * (`fetchArchive` fallback, dashboard snapshot hydrate, messaging `Link[]`
 * hydrate) MUST await this and check `authorized: true` before reading the
 * vault. UI chrome that only shows/hides badges should hold a `ref` filled by
 * this same helper on mount — never a separate weaker sync gate.
 */
export async function isOfflineModeAuthorized(): Promise<OfflineModeState> {
  if (!isOfflineVaultRuntime()) return { authorized: false, reason: 'no-desktop' };

  // Resolve the device's known identity. Prefer the live session (normal
  // online boot); fall back to the persisted saved-accounts store (IndexedDB,
  // no network) so a returning "stay logged in" user is recognized even when
  // the app STARTS fully offline and checkSession() can't reach the server.
  let username: string | null = null;
  const { useAuthStore } = await import('src/stores/auth');
  const authStore = useAuthStore();
  if (authStore.isLoggedIn && authStore.user?.username) {
    username = authStore.user.username;
  } else {
    try {
      const { useAccountsStore } = await import('src/stores/accounts');
      const accountsStore = useAccountsStore();
      await accountsStore.load();
      const account = accountsStore.activeAccount ?? accountsStore.savedAccounts[0];
      username = account?.username ?? null;
    } catch {
      username = null;
    }
  }
  if (!username) {
    return { authorized: false, reason: 'not-authed' };
  }

  // "Stay logged in" chosen → credential actually saved in the OS keychain.
  const { getCredentials } = (await import('src/composables/useSecureStore')).useSecureStore();
  try {
    const stored = await getCredentials(username);
    if (!stored?.password) {
      return { authorized: false, reason: 'not-stay-logged-in' };
    }
  } catch {
    // Keychain failure is a miss — never grant offline on an unverifiable path.
    return { authorized: false, reason: 'not-stay-logged-in' };
  }

  return { authorized: true };
}

/**
 * Encrypt an archive/graveyard blob with the app-scoped key.
 * Returns base64 ciphertext + base64 nonce. Throws if no key is available
 * (non-desktop) or AEAD setup fails.
 */
function associatedData(context: OfflineBlobContext, blob: Pick<EncryptedBlob, 'meta' | 'savedAt'>): Uint8Array {
  if (!context.kind || typeof context.id !== 'string' ||
      (context.accountId !== undefined && !context.accountId) ||
      !Number.isSafeInteger(blob.savedAt) || blob.savedAt < 0) {
    throw new Error('Invalid offline vault context');
  }
  const metadata = Object.entries(blob.meta ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (metadata.some(([, value]) => typeof value !== 'string')) throw new Error('Invalid offline metadata');
  return sodium.from_string(JSON.stringify([
    'mourn-offline-v2', context.kind, context.id, context.accountId ?? null, blob.savedAt, metadata,
  ]));
}

export async function encryptOfflineBlob(
  plainBytes: Uint8Array,
  meta?: Record<string, string>,
  context: OfflineBlobContext = { kind: 'blob', id: '' },
): Promise<EncryptedBlob> {
  if (!isOfflineVaultRuntime()) {
    throw new Error('Offline vault is desktop-only.');
  }
  await sodium.ready;
  const key = await getOrCreateOfflineKey();
  if (!key) {
    throw new Error('Offline vault key unavailable.');
  }

  const header = { meta: meta ? { ...meta } : undefined, savedAt: Date.now() };
  const ad = associatedData(context, header);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plainBytes,
    ad,
    null,
    nonce,
    key,
  );
  return {
    ciphertextB64: sodium.to_base64(ciphertext),
    nonceB64: sodium.to_base64(nonce),
    version: 2,
    ...header,
  };
}

/**
 * Decrypt an `EncryptedBlob` back to plaintext. Throws (AEAD auth failure) if
 * the ciphertext was tampered with or the key does not match.
 */
export async function decryptOfflineBlob(
  blob: EncryptedBlob,
  context: OfflineBlobContext = { kind: 'blob', id: '' },
  options: { allowLegacy?: boolean } = {},
): Promise<Uint8Array> {
  if (!isOfflineVaultRuntime()) {
    throw new Error('Offline vault is desktop-only.');
  }
  await sodium.ready;
  const key = await getOrCreateOfflineKey();
  if (!key) {
    throw new Error('Offline vault key unavailable.');
  }

  const ciphertext = sodium.from_base64(blob.ciphertextB64);
  const nonce = sodium.from_base64(blob.nonceB64);
  if (blob.version !== undefined && blob.version !== 2) throw new Error('Unsupported offline blob version');
  if (blob.version === undefined && !options.allowLegacy) {
    throw new Error('Legacy offline blob requires explicit compatibility migration');
  }
  const ad = blob.version === 2 ? associatedData(context, blob) : null;
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, ad, nonce, key);
}

async function scopedContext(kind: OfflineVaultKind, id: string, context?: OfflineBlobContext): Promise<OfflineBlobContext> {
  if (context && (context.kind !== kind || context.id !== id)) throw new Error('Offline context does not match record');
  if (context?.accountId) return { ...context };
  const { useAuthStore } = await import('src/stores/auth');
  const auth = useAuthStore();
  let accountId = auth.user?.id;
  if (!accountId) {
    const { useAccountsStore } = await import('src/stores/accounts');
    const accounts = useAccountsStore();
    await accounts.load();
    accountId = (accounts.activeAccount ?? accounts.savedAccounts[0])?.id;
  }
  if (!accountId) throw new Error('Offline cache requires a selected account');
  return { kind, id, accountId };
}

function recordKey(kind: OfflineVaultKind, context: OfflineBlobContext): string {
  return namespaceFor(kind) + ':account:' + JSON.stringify([context.accountId, context.id]);
}

/** Persist an encrypted blob (already produced by `encryptOfflineBlob`) to IndexedDB. */
export async function saveOfflineBlob(
  kind: OfflineVaultKind,
  id: string,
  blob: EncryptedBlob,
  context?: OfflineBlobContext,
): Promise<void> {
  if (!isOfflineVaultRuntime()) return;
  const scope = await scopedContext(kind, id, context);
  await set(recordKey(kind, scope), blob);
}

/** Load an encrypted blob from IndexedDB (still ciphertext; decrypt separately). */
export async function loadOfflineBlob(
  kind: OfflineVaultKind,
  id: string,
  context?: OfflineBlobContext,
): Promise<EncryptedBlob | undefined> {
  if (!isOfflineVaultRuntime()) return undefined;
  const scope = await scopedContext(kind, id, context);
  return get<EncryptedBlob>(recordKey(kind, scope));
}

/** Remove a single offline blob from IndexedDB. */
export async function removeOfflineBlob(kind: OfflineVaultKind, id: string, context?: OfflineBlobContext): Promise<void> {
  if (!isOfflineVaultRuntime()) return;
  const scope = await scopedContext(kind, id, context);
  await del(recordKey(kind, scope));
}

/**
 * High-level helper: encrypt + persist in one shot for a downloaded archive or
 * graveyard galaxy entry. Returns the idempotent IndexedDB key used.
 */
export async function storeOfflineBlob(
  kind: OfflineVaultKind,
  id: string,
  plainBytes: Uint8Array,
  meta?: Record<string, string>,
  context: OfflineBlobContext = { kind, id },
): Promise<void> {
  if (context.kind !== kind || context.id !== id) throw new Error('Offline context does not match record');
  if (!isOfflineVaultRuntime()) throw new Error('Offline vault is native-only');
  const scope = await scopedContext(kind, id, context);
  const blob = await encryptOfflineBlob(plainBytes, meta, scope);
  await saveOfflineBlob(kind, id, blob, scope);
}

/**
 * High-level helper: load + decrypt in one shot. Throws on auth failure.
 * Returns undefined when nothing is cached for that id.
 */
export async function readOfflineBlob(
  kind: OfflineVaultKind,
  id: string,
  context: OfflineBlobContext = { kind, id },
): Promise<Uint8Array | undefined> {
  if (context.kind !== kind || context.id !== id) throw new Error('Offline context does not match record');
  if (!isOfflineVaultRuntime()) return undefined;
  const scope = await scopedContext(kind, id, context);
  const blob = await loadOfflineBlob(kind, id, scope);
  if (!blob) {
    if (await get(`${namespaceFor(kind)}:${id}`)) {
      throw new Error('Legacy offline cache retained. Re-download it to bind it to this account.');
    }
    return undefined;
  }
  return decryptOfflineBlob(blob, scope);
}

/** Explicit legacy migration: the caller must validate ownership/content because
 * legacy AEAD did not bind record identity or metadata. Failed validation/write
 * retains the original record. No caller data is erased or silently re-labelled.
 */
export async function migrateOfflineBlob(
  kind: OfflineVaultKind,
  id: string,
  validate: (plaintext: Uint8Array, meta: EncryptedBlob['meta']) => boolean | Promise<boolean>,
  context: OfflineBlobContext = { kind, id },
): Promise<boolean> {
  if (context.kind !== kind || context.id !== id) throw new Error('Offline context does not match record');
  if (!isOfflineVaultRuntime()) return false;
  // Only an explicit owner/content validator may copy an unscoped legacy blob.
  if (!context.accountId) throw new Error('Legacy migration requires an explicit account');
  const old = await get<EncryptedBlob>(`${namespaceFor(kind)}:${id}`);
  if (!old) return false;
  if (old.version === 2) { await decryptOfflineBlob(old, context); return true; }
  const plain = await decryptOfflineBlob(old, context, { allowLegacy: true });
  try {
    if (!(await validate(plain, old.meta ? { ...old.meta } : undefined))) return false;
    const replacement = await encryptOfflineBlob(plain, old.meta, context);
    await update<EncryptedBlob>(recordKey(kind, context), (current) => {
      if (current) throw new Error('Scoped offline record already exists; migration will not overwrite it');
      return replacement;
    });
    // Retain the legacy source for owner-reviewed recovery; never guess a wipe.
    return true;
  } finally { plain.fill(0); }
}

export interface RatchetStorageContext {
  accountId: string;
  deviceId: string;
  sessionId: string; // Include link AND peer device identity, not just a user id.
}

function ratchetContext(scope: RatchetStorageContext): OfflineBlobContext {
  if (!scope.accountId || !scope.deviceId || !scope.sessionId) throw new Error('Incomplete ratchet storage scope');
  return { kind: 'messaging', id: JSON.stringify(['ratchet-v1', scope.accountId, scope.deviceId, scope.sessionId]), accountId: scope.accountId };
}

async function validatedRatchetState(state: RatchetState): Promise<RatchetState> {
  const checked = new DoubleRatchet();
  await checked.init();
  checked.importState(state);
  const exported = checked.exportState();
  // DoubleRatchet validates the binding on import but does not retain it on export.
  if (state.devicePubBinding !== undefined) {
    const { myDevicePubHex, theirDevicePubHex, bindingTime } = state.devicePubBinding;
    exported.devicePubBinding = { myDevicePubHex, theirDevicePubHex, bindingTime };
  }
  if (state.receivedPacketHashes !== undefined) {
    const hashes = state.receivedPacketHashes;
    if (!Array.isArray(hashes) || hashes.length > MAX_RATCHET_RECEIPTS ||
      hashes.some((hash) => typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))) {
      throw new Error('Invalid ratchet receipt evidence');
    }
    exported.receivedPacketHashes = [...hashes];
  }
  return exported;
}

/** Store integration: await successful persistence before removing any legacy copy. */
export async function setEncryptedRatchetState(scope: RatchetStorageContext, state: RatchetState): Promise<void> {
  const validated = await validatedRatchetState(state);
  const context = ratchetContext(scope);
  const bytes = sodium.from_string(JSON.stringify(validated));
  try { await storeOfflineBlob('messaging', context.id, bytes, undefined, context); }
  finally { bytes.fill(0); }
}

export async function removeEncryptedRatchetStates(accountId: string, linkId?: string): Promise<void> {
  if (!accountId || accountId === 'unknown') throw new Error('Ratchet deletion requires an account');
  for (const key of await keys()) {
    if (typeof key !== 'string' || !key.startsWith(MESSAGING_NS + ':')) continue;
    let scope: unknown;
    try {
      if (key.startsWith(MESSAGING_NS + ':account:')) {
        const owner: unknown = JSON.parse(key.slice((MESSAGING_NS + ':account:').length));
        if (!Array.isArray(owner) || owner[0] !== accountId || typeof owner[1] !== 'string') continue;
        scope = JSON.parse(owner[1]);
      } else scope = JSON.parse(key.slice(MESSAGING_NS.length + 1));
    } catch { continue; }
    if (!Array.isArray(scope) || scope[0] !== 'ratchet-v1' || scope[1] !== accountId || typeof scope[3] !== 'string') continue;
    if (linkId && !scope[3].startsWith(linkId + '_') && !scope[3].startsWith('self_' + linkId + '_')) continue;
    await del(key);
  }
}

/** Erase only tuple-scoped records with an explicit owner. Unscoped legacy
 * blobs are retained for manual recovery rather than assigned to this account.
 */
export async function clearOfflineBlobsForUser(accountId: string): Promise<void> {
  if (!accountId || accountId === 'unknown') throw new Error('Offline cleanup requires an account');
  const prefixes = [ARCHIVE_NS, GRAVEYARD_NS, DASHBOARD_NS, MESSAGING_NS].map((ns) => ns + ':account:');
  for (const key of await keys()) {
    if (typeof key !== 'string') continue;
    const prefix = prefixes.find((candidate) => key.startsWith(candidate));
    if (!prefix) continue;
    let scope: unknown;
    try { scope = JSON.parse(key.slice(prefix.length)); } catch { continue; }
    if (Array.isArray(scope) && scope.length === 2 && scope[0] === accountId) await del(key);
  }
}

export async function getEncryptedRatchetState(scope: RatchetStorageContext): Promise<RatchetState | undefined> {
  const context = ratchetContext(scope);
  const bytes = await readOfflineBlob('messaging', context.id, context);
  if (!bytes) return undefined;
  try {
    return await validatedRatchetState(JSON.parse(sodium.to_string(bytes)) as RatchetState);
  } finally { bytes.fill(0); }
}

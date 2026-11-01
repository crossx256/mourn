// crypto/groupLocalVault.ts
//
// Encrypted at-rest storage for the authenticated user's group memberships.
//
// Threat model note (important, so we don't over-claim): this protects group
// metadata from being read in PLAINTEXT — e.g. a scripted `localStorage` dump,
// an XSS that reads localStorage, or a casual inspection of the WebView's
// storage. It is NOT a substitute for a user-held passphrase: the 32-byte
// storage key lives in IndexedDB exactly like the app's existing key material
// (KeyManager / idb-keyval). An attacker who has full read access to the same
// WebView origin can read both key and ciphertext. This matches how the rest
// of the app persists secrets at rest and is strictly safer than the previous
// plaintext `localStorage` usage.
//
// Cipher: XSalsa20-Poly1305 (libsodium crypto_secretbox_easy). Keyed by user.

import sodium from 'libsodium-wrappers';
import { get, set, del, keys } from 'idb-keyval';
import { getOrCreateStorageKey } from './storageKey';

const KEY_BASE = 'mourn_group_vault_key';
const DATA_BASE = 'mourn_group_vault_data';

/** Namespaced IDB keys so switching users isolates data. */
function keyName(uid: string): string {
  return `${KEY_BASE}_uid_${uid}`;
}
function dataName(uid: string): string {
  return `${DATA_BASE}_uid_${uid}`;
}

interface EncryptedEnvelope {
  v: 1;
  nonce: string; // base64
  ct: string; // base64 (ciphertext + MAC tag)
}

/**
 * Get (creating if needed) the per-user 32-byte storage key.
 * Stored in origin-scoped IndexedDB via idb-keyval (not plaintext localStorage).
 */
export async function getOrCreateGroupStorageKey(uid: string): Promise<Uint8Array> {
  if (!uid) throw new Error('Group storage requires an account');
  return getOrCreateStorageKey(keyName(uid));
}

/** Serialize + encrypt an array of plain group records. */
export async function encryptGroups(uid: string, groups: unknown[], assertCurrent: () => void = () => {}): Promise<void> {
  assertCurrent();
  const plaintext = JSON.stringify(groups);
  await sodium.ready;
  const key = await getOrCreateGroupStorageKey(uid);
  assertCurrent();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key);
  const envelope: EncryptedEnvelope = {
    v: 1,
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    ct: sodium.to_base64(ct, sodium.base64_variants.ORIGINAL),
  };
  await set(dataName(uid), envelope);
}

/**
 * Decrypt + parse the stored group records.
 * Returns null if nothing is stored or if the envelope is malformed.
 * Throws only on authentication failure (tamper/corruption) — callers decide.
 */
export async function decryptGroups(uid: string): Promise<unknown[] | null> {
  if (!uid) throw new Error('Group storage requires an account');
  await sodium.ready;
  const envelope = await get<EncryptedEnvelope>(dataName(uid));
  if (!envelope) return null;
  if (envelope.v !== 1 || !envelope.nonce || !envelope.ct) return null;

  const key = await getOrCreateGroupStorageKey(uid);
  const nonce = sodium.from_base64(envelope.nonce, sodium.base64_variants.ORIGINAL);
  const ct = sodium.from_base64(envelope.ct, sodium.base64_variants.ORIGINAL);

  const plaintext = sodium.crypto_secretbox_open_easy(ct, nonce, key);
  const json = sodium.to_string(plaintext);
  return JSON.parse(json) as unknown[];
}

/** Remove stored data (used when a user fully leaves + deletes). */
export async function clearGroups(uid: string): Promise<void> {
  if (!uid) throw new Error('Group storage requires an account');
  await del(dataName(uid));
}

/** Call after invalidating/draining the outgoing account's group operations.
 * MLS checkpoints/pending packages have a separate clearMlsStorageForUser owner.
 */
export async function clearGroupStorageForUser(uid: string): Promise<void> {
  if (!uid || uid === 'unknown') throw new Error('Group cleanup requires an account');
  const suffix = `_uid_${uid}`;
  for (const key of await keys()) {
    if (typeof key === 'string' && key.endsWith(suffix) &&
        (key.startsWith('group_messages_') || key.startsWith('group_hidden_messages_') || key === dataName(uid))) {
      await del(key);
    }
  }
  if (typeof localStorage !== 'undefined') {
    const cursors: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('group_sync_') && key.endsWith(suffix)) cursors.push(key);
    }
    for (const key of cursors) localStorage.removeItem(key);
  }
  await del(keyName(uid));
}

// crypto/mlsDb.ts
//
// IndexedDB persistence for MLS group state, encrypted-at-rest.
//
// The stored blob is the serialized ClientState (ratchet tree + secrets). It is
// encrypted with XSalsa20-Poly1305 (libsodium crypto_secretbox_easy) under a
// per-user 32-byte key stored in IndexedDB (idb-keyval). This matches the rest
// of the app's at-rest posture and the 1:1 KeyManager/groupLocalVault behavior:
// it protects against a plaintext storage dump / XSS localStorage read, but is
// NOT a substitute for a user-held passphrase (the key and ciphertext are both
// reachable by an attacker with full origin access).
//
// Schema: one record per (group, device) in the `mourn_mls` database.

import sodium from 'libsodium-wrappers';
import { get, set, del, keys } from 'idb-keyval';
import { assertMlsAddCheckpoint, type GroupHistoryCheckpoint, type PreparedMlsRemoval, type PreparedMlsAdd } from './groupCheckpoint';
import { decodeGroupState } from 'ts-mls';
import { getOrCreateStorageKey } from './storageKey';
import { drainGroupOperationsForUser } from './groupOperation';

const DB_NAME = 'mourn_mls';
const STORE = 'group_state';
const VERSION = 1;

const KEY_BASE = 'mourn_mls_state_key';


function keyName(uid: string): string {
  return `${KEY_BASE}_uid_${uid}`;
}

export interface MlsGroupRecord {
  id: string; // `${uid}:${groupId}:${deviceId}` (legacy: `${groupId}:${deviceId}`)
  groupId: string;
  deviceId: string;
  serialized: string; // encrypted envelope (at rest); decrypted on read
  epoch: number;
  updatedAt: number;
  /**
   * The group's OWN MLS ciphersuite, read out of the serialized state.
   *
   * An MLS group keeps its ciphersuite for life, so this must be threaded back
   * into `MlsGroupClient` on load. Before this field existed, state saved by an
   * older build (AES-256-GCM era) was always re-decoded with whatever suite the
   * current build defaulted to — which is precisely why suites created before an
   * update stopped working after one.
   */
  cipherSuite?: string | null;
  /** One atomic authoritative checkpoint; legacy IDB/localStorage are import-only. */
  checkpoint?: GroupHistoryCheckpoint;
  pendingRemoval?: PreparedMlsRemoval;
  pendingAdd?: PreparedMlsAdd;
  revision?: string;
}

type StoredMlsGroupRecord = Omit<MlsGroupRecord, 'checkpoint' | 'pendingRemoval' | 'pendingAdd'> & {
  checkpoint?: string;
  pendingRemoval?: string;
  pendingAdd?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Get (creating if needed) the per-user 32-byte MLS storage key. */
async function getOrCreateMlsStorageKey(uid: string): Promise<Uint8Array> {
  if (!uid) throw new Error('MLS storage requires an account');
  return getOrCreateStorageKey(keyName(uid));
}

// ---------------------------------------------------------------------------
// Envelope format
//   v2.<ciphersuite|-><nonceB64>.<ctB64>   current (suite recorded)
//   v1.<nonceB64>.<ctB64>                  encrypted, suite unknown from header
//   anything else                          PLAINTEXT state from a build that
//                                          predates at-rest encryption
// ---------------------------------------------------------------------------

const ENVELOPE_V2 = 'v2';
const ENVELOPE_V1 = 'v1';
/** Placeholder when the suite could not be read from the serialized state. */
const UNKNOWN_SUITE = '-';

/**
 * Read the ciphersuite out of a serialized ClientState.
 *
 * `decodeGroupState` needs no ciphersuite implementation — the state carries its
 * own — so this is safe to call on state produced by ANY earlier build.
 */
function suiteFromSerializedState(serialized: string): string | null {
  try {
    const decoded = decodeGroupState(b64ToBytes(serialized), 0);
    const suite = (decoded?.[0] as { groupContext?: { cipherSuite?: unknown } } | undefined)
      ?.groupContext?.cipherSuite;
    return typeof suite === 'string' && suite.length > 0 ? suite : null;
  } catch {
    return null;
  }
}

function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith(`${ENVELOPE_V2}.`) || value.startsWith(`${ENVELOPE_V1}.`);
}

async function encryptState(uid: string, plaintext: string): Promise<string> {
  await sodium.ready;
  const key = await getOrCreateMlsStorageKey(uid);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key);
  const nonceB64 = sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL);
  const ctB64 = sodium.to_base64(ct, sodium.base64_variants.ORIGINAL);
  const suite = suiteFromSerializedState(plaintext) ?? UNKNOWN_SUITE;
  return `${ENVELOPE_V2}.${suite}.${nonceB64}.${ctB64}`;
}

interface DecryptedState {
  plaintext: string;
  /** Suite from the serialized state itself; the envelope value is a fallback. */
  cipherSuite: string | null;
}

async function decryptState(uid: string, encoded: string): Promise<DecryptedState> {
  await sodium.ready;
  const parts = encoded.split('.');

  let noncePart: string;
  let ctPart: string;
  let envelopeSuite: string | null = null;

  if (parts[0] === ENVELOPE_V2 && parts.length === 4) {
    envelopeSuite = parts[1] === UNKNOWN_SUITE ? null : (parts[1] as string);
    noncePart = parts[2] as string;
    ctPart = parts[3] as string;
  } else if (parts[0] === ENVELOPE_V1 && parts.length === 3) {
    // Encrypted before the suite was recorded in the header.
    noncePart = parts[1] as string;
    ctPart = parts[2] as string;
  } else {
    throw new Error('mls: malformed group state envelope');
  }

  const key = await getOrCreateMlsStorageKey(uid);
  const nonce = sodium.from_base64(noncePart, sodium.base64_variants.ORIGINAL);
  const ct = sodium.from_base64(ctPart, sodium.base64_variants.ORIGINAL);
  const plaintext = sodium.to_string(sodium.crypto_secretbox_open_easy(ct, nonce, key));

  return {
    plaintext,
    cipherSuite: suiteFromSerializedState(plaintext) ?? envelopeSuite,
  };
}

export async function putGroupState(
  rec: Omit<MlsGroupRecord, 'updatedAt'>,
  uid: string,
  assertCurrent: () => void = () => {},
  expectedRevision?: string | null,
): Promise<string> {
  assertCurrent();
  assertMlsAddCheckpoint(rec);
  // All asynchronous encryption happens before opening the atomic transaction.
  const serialized = await encryptState(uid, rec.serialized);
  const checkpoint = rec.checkpoint ? await encryptState(uid, JSON.stringify(rec.checkpoint)) : undefined;
  const pendingRemoval = rec.pendingRemoval ? await encryptState(uid, JSON.stringify(rec.pendingRemoval)) : undefined;
  const pendingAdd = rec.pendingAdd ? await encryptState(uid, JSON.stringify(rec.pendingAdd)) : undefined;
  const revision = crypto.randomUUID();
  const db = await openDb();
  try { assertCurrent(); } catch (error) { db.close(); throw error; }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const id = `${uid}:${rec.groupId}:${rec.deviceId}`;
    let failure: unknown;
    const current = store.get(id);
    current.onsuccess = () => {
      try {
        assertCurrent();
        const prior = current.result as StoredMlsGroupRecord | undefined;
        if (expectedRevision !== undefined && (prior ? prior.revision ?? prior.serialized : null) !== expectedRevision) {
          throw new Error('MLS checkpoint changed in another operation/window; reload the Suite before retrying');
        }
        store.put({ ...rec, id, serialized, checkpoint, pendingRemoval, pendingAdd, revision, updatedAt: Date.now() });
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => { db.close(); resolve(revision); };
    tx.onerror = tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('MLS checkpoint write aborted')); };
  });
}

export async function getGroupState(
  groupId: string,
  deviceId: string,
  uid: string,
  assertCurrent: () => void = () => {},
): Promise<MlsGroupRecord | null> {
  if (!uid) throw new Error('MLS storage requires an account');
  assertCurrent();
  const db = await openDb();
  const scopedId = `${uid}:${groupId}:${deviceId}`;
  const legacyId = `${groupId}:${deviceId}`;
  const readRecord = (id: string) =>
    new Promise<StoredMlsGroupRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as StoredMlsGroupRecord | undefined);
      req.onerror = () => reject(req.error);
    });

  let raw: StoredMlsGroupRecord | undefined;
  try {
    raw = (await readRecord(scopedId)) ?? (await readRecord(legacyId));
    assertCurrent();
  } catch (error) { db.close(); throw error; }
  if (!raw) { db.close(); return null; }
  const sourceRecord = raw;

  // Encrypt before opening the transaction; no asynchronous crypto inside an IDB tx.
  // Compare the source and destination under the same write lock so concurrent saves
  // cannot be overwritten and a scoped source is never deleted after being replaced.
  const migrate = async (result: StoredMlsGroupRecord): Promise<void> => {
    const encrypted = await encryptState(uid, result.serialized);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('MLS migration aborted'));
      const source = store.get(sourceRecord.id);
      source.onsuccess = () => {
        try { assertCurrent(); } catch { tx.abort(); return; }
        if (JSON.stringify(source.result) !== JSON.stringify(sourceRecord)) { tx.abort(); return; }
        const destination = store.get(scopedId);
        destination.onsuccess = () => {
          try { assertCurrent(); } catch { tx.abort(); return; }
          if (sourceRecord.id !== scopedId && destination.result !== undefined) { tx.abort(); return; }
          store.put({ ...result, serialized: encrypted, updatedAt: Date.now() });
          if (sourceRecord.id !== scopedId) store.delete(sourceRecord.id);
        };
      };
    });
  };

  // (1) PLAINTEXT state written before at-rest encryption existed. It is still
  //     perfectly valid group state, so MIGRATE it (encrypt + re-key to the
  //     scoped id) instead of throwing it away. This is what lets a group that
  //     predates an update keep working after it.
  if (typeof raw.serialized === 'string' && !isEncryptedEnvelope(raw.serialized)) {
    const suite = suiteFromSerializedState(raw.serialized);
    if (suite) {
      try {
        const migrated: StoredMlsGroupRecord = {
          ...raw,
          id: scopedId,
          cipherSuite: suite,
        };
        await migrate(migrated);
        db.close();
        console.info('[MLS DB] Migrated plaintext group state to encrypted storage', {
          groupId,
          cipherSuite: suite,
        });
        return getGroupState(groupId, deviceId, uid, assertCurrent);
      } catch (error) {
        console.warn('[MLS DB] Plaintext group state migration failed', { groupId, error });
        db.close();
        throw new Error('MLS plaintext migration did not complete; original record retained', { cause: error });
      }
    }
  }

  try {
    // Decrypt at-rest envelope back into the plaintext serialized ClientState.
    const { plaintext, cipherSuite } = await decryptState(uid, raw.serialized);
    if (raw.id === legacyId) {
      await migrate({ ...raw, id: scopedId, serialized: plaintext, cipherSuite });
      db.close();
      return getGroupState(groupId, deviceId, uid, assertCurrent);
    }
    const checkpoint = raw.checkpoint
      ? JSON.parse((await decryptState(uid, raw.checkpoint)).plaintext) as GroupHistoryCheckpoint
      : undefined;
    if (checkpoint && (checkpoint.version !== 1 || !Array.isArray(checkpoint.messages) || !Array.isArray(checkpoint.hiddenIds) || !checkpoint.hiddenIds.every((id) => typeof id === 'string') || (checkpoint.cursor !== null && typeof checkpoint.cursor !== 'string'))) {
      throw new Error('Malformed MLS history checkpoint');
    }
    const pendingRemoval = raw.pendingRemoval
      ? JSON.parse((await decryptState(uid, raw.pendingRemoval)).plaintext) as PreparedMlsRemoval
      : undefined;
    if (pendingRemoval && (pendingRemoval.version !== 1 || pendingRemoval.kind !== 'remove' || !['prepared', 'publishing'].includes(pendingRemoval.phase) || pendingRemoval.deviceId !== deviceId || !pendingRemoval.commit || !pendingRemoval.serialized || pendingRemoval.beforeSerialized !== plaintext || !Number.isSafeInteger(pendingRemoval.epoch))) {
      throw new Error('Malformed or conflicting pending MLS removal; evidence retained');
    }
    const pendingAdd = raw.pendingAdd
      ? JSON.parse((await decryptState(uid, raw.pendingAdd)).plaintext) as PreparedMlsAdd
      : undefined;
    assertMlsAddCheckpoint({ ...raw, serialized: plaintext, cipherSuite: cipherSuite ?? raw.cipherSuite, pendingRemoval, pendingAdd });
    assertCurrent();
    db.close();
    return { ...raw, id: scopedId, serialized: plaintext, cipherSuite, checkpoint, pendingRemoval, pendingAdd, revision: raw.revision ?? raw.serialized };
  } catch (error) {
    db.close();
    // A previous concurrent first-run could persist a scoped record under a
    // different freshly generated key. Treat that as a corrupt local cache so
    // invitees can recover from their durable Welcome.
    //
    // NOTE: this deliberately does NOT delete the record any more. Deleting it
    // used to be how "unreadable after an update" turned into permanent data
    // loss — the raw bytes are the only copy of the ratchet state, and they
    // remain readable if the key or the reader changes. An unreadable legacy
    // record may also belong to another account, so never let this account
    // remove it either.
    console.warn('[MLS DB] Ignoring unreadable local group state', {
      groupId,
      deviceId,
      recordId: raw.id,
    });
    throw new Error('MLS checkpoint unreadable; original state and recovery evidence retained', { cause: error });
  }
}

// ---------------------------------------------------------------------------
// Pending key-package persistence (invitee side). The invitee's MLS PRIVATE key
// package is persisted (encrypted) so the Welcome can be joined even after a
// reload/reconnect — previously this lived only in an in-memory Map and a
// reload permanently locked the invitee out of the group.
// ---------------------------------------------------------------------------

const PENDING_PREFIX = 'mourn_mls_pending_kp';

function pendingKeyName(groupId: string, uid: string, deviceId?: string): string {
  return deviceId
    ? `${PENDING_PREFIX}_${JSON.stringify([uid, deviceId, groupId])}`
    : `${PENDING_PREFIX}_${uid}_${groupId}`;
}

/** A persisted invitee key-package pair (private fields base64-encoded). */
export interface PendingKeyPackageRecord {
  publicPackageB64: string;
  privatePackage: {
    initPrivateKey: string;
    hpkePrivateKey: string;
    signaturePrivateKey: string;
  };
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) ?? 0;
  return out;
}

export async function putPendingKeyPackage(
  groupId: string,
  record: PendingKeyPackageRecord,
  uid: string,
  deviceId: string,
  assertCurrent: () => void = () => {},
): Promise<void> {
  assertCurrent();
  const plaintext = JSON.stringify(record);
  const encrypted = await encryptState(uid, plaintext);
  assertCurrent();
  await set(pendingKeyName(groupId, uid, deviceId), encrypted);
}

export async function getPendingKeyPackage(
  groupId: string,
  uid: string,
  deviceId: string,
  assertCurrent: () => void = () => {},
): Promise<PendingKeyPackageRecord | null> {
  assertCurrent();
  const scoped = await get<string | undefined>(pendingKeyName(groupId, uid, deviceId));
  const encoded = scoped ?? (await get<string | undefined>(pendingKeyName(groupId, uid)));
  if (!encoded) return null;
  const { plaintext } = await decryptState(uid, encoded);
  const record = JSON.parse(plaintext) as PendingKeyPackageRecord;
  const { MlsGroupClient } = await import('./mlsGroup');
  const keyPackage = await MlsGroupClient.decodeKeyPackage(record.publicPackageB64);
  const credential = keyPackage.leafNode.credential;
  if (
    credential.credentialType !== 'basic' ||
    new TextDecoder().decode(credential.identity) !== deviceId
  ) {
    return null;
  }
  assertCurrent();
  if (!scoped) {
    await putPendingKeyPackage(groupId, record, uid, deviceId, assertCurrent);
    assertCurrent();
    const { del } = await import('idb-keyval');
    await del(pendingKeyName(groupId, uid));
  }
  return record;
}

export async function deletePendingKeyPackage(
  groupId: string,
  uid: string,
  deviceId: string,
): Promise<void> {
  const { del } = await import('idb-keyval');
  await del(pendingKeyName(groupId, uid, deviceId));
}

/** Delete only explicitly UID-owned records. Unscoped legacy MLS rows have no
 * trustworthy owner and are reported, not guessed or removed.
 * Invalidate/drain the account's group operations before invoking this owner.
 */
export async function clearMlsStorageForUser(uid: string): Promise<{ retainedLegacyRecords: string[] }> {
  if (!uid || uid === 'unknown') throw new Error('MLS cleanup requires an account');
  await drainGroupOperationsForUser(uid);
  const db = await openDb();
  const retainedLegacyRecords: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const request = tx.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const row = cursor.value as StoredMlsGroupRecord;
      if (row.id.startsWith(`${uid}:`)) cursor.delete();
      else if (row.id === `${row.groupId}:${row.deviceId}`) retainedLegacyRecords.push(row.id);
      cursor.continue();
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('MLS cleanup aborted')); };
  });
  for (const key of await keys()) {
    if (typeof key !== 'string' || !key.startsWith(PENDING_PREFIX + '_')) continue;
    const suffix = key.slice(PENDING_PREFIX.length + 1);
    if (suffix.startsWith('[')) {
      let scope: unknown;
      try { scope = JSON.parse(suffix); } catch { continue; }
      if (Array.isArray(scope) && scope[0] === uid) await del(key);
    } else if (suffix.startsWith(uid + '_')) await del(key);
  }
  // An unscoped legacy row may still need this key for owner-reviewed recovery.
  if (!retainedLegacyRecords.length) await del(keyName(uid));
  return { retainedLegacyRecords };
}

export { bytesToB64, b64ToBytes };

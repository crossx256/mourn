import { getCurrentScope, onScopeDispose, reactive } from 'vue';
import sodium from 'libsodium-wrappers';

const DB_NAME = 'mourn-vault-attachments';
const DB_VERSION = 2;
const STORE_NAME = 'encrypted-attachments';
const MAX_CACHED_ATTACHMENTS = 40;
const MAX_CACHE_BYTES = 48 * 1024 * 1024;

export interface AttachmentCacheContext {
  accountId: string;
  /** Use the link id for Vault and `group:<id>` for Suites. */
  conversationId: string;
  messageId: string;
  /** Absolute message/conversation deadline, or null for persistent messages. */
  expiresAt: number | null;
  /** Required for ephemeral-session messages; null otherwise. */
  sessionId: string | null;
  /** Existing E2EE attachment key. Never stored in the attachment database. */
  keyHex: string;
}
export interface AttachmentMetadata { filename: string; mimetype: string; size: number }
export interface CachedVaultAttachment extends AttachmentMetadata {
  blobId: string;
  blob: Blob;
  cachedAt: number;
}
interface EncryptedAttachment {
  id: string;
  blobId: string;
  accountId: string;
  conversationId: string;
  messageId: string;
  expiresAt: number | null;
  sessionId: string | null;
  cachedAt: number;
  size: number;
  nonceHex: string;
  ciphertext: Uint8Array;
}
type Scope = Omit<AttachmentCacheContext, 'keyHex'>;
const urls = new Map<string, { url: string; scope: Scope; owners: Set<symbol> }>();
const owners = new Map<symbol, () => void>();
let dbPromise: Promise<IDBDatabase> | null = null;
let revision = 0;


function valid(context: AttachmentCacheContext): boolean {
  return Boolean(context.accountId && context.conversationId && context.messageId) && /^[a-f0-9]{64}$/i.test(context.keyHex) &&
    (context.expiresAt === null || (Number.isFinite(context.expiresAt) && context.expiresAt > Date.now()));
}
function scopeOf(context: AttachmentCacheContext): Scope {
  const { accountId, conversationId, messageId, expiresAt, sessionId } = context;
  return { accountId, conversationId, messageId, expiresAt, sessionId };
}
function cacheId(blobId: string, context: Scope): string {
  return JSON.stringify([context.accountId, context.conversationId, context.messageId, blobId, context.expiresAt, context.sessionId]);
}
function aad(entry: Pick<EncryptedAttachment, 'id' | 'size' | 'cachedAt'>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([entry.id, entry.size, entry.cachedAt]));
}
function invalidated(_scope: Scope, started: number): boolean {
  // Purge is rare. Conservatively invalidate every in-flight cache operation;
  // do not retain an unbounded list of predicates/account identifiers.
  return revision !== started;
}
function revoke(id: string): void {
  const entry = urls.get(id);
  if (!entry) return;
  URL.revokeObjectURL(entry.url);
  urls.delete(id);
}
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      // Legacy previews are unscoped plaintext. Delete ONLY that cache, never history.
      const db = request.result;
      if (db.objectStoreNames.contains('attachments')) db.deleteObjectStore('attachments');
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Attachment cache unavailable'));
    request.onblocked = () => reject(new Error('Close other app windows to upgrade attachment cache'));
  }).catch((error: unknown) => { dbPromise = null; throw error; });
  return dbPromise;
}
async function records(): Promise<EncryptedAttachment[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as EncryptedAttachment[]);
    request.onerror = () => reject(request.error);
  });
}
async function removeRecords(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const id of ids) tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve(ids.length);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Cache deletion failed'));
  });
}
async function purge(matches: (scope: Scope) => boolean): Promise<number> {
  ++revision;
  for (const [id, entry] of urls) if (matches(entry.scope)) revoke(id);
  for (const refresh of owners.values()) refresh();
  return removeRecords((await records()).filter(matches).map((entry) => entry.id));
}

export const purgeAttachmentAccount = (accountId: string): Promise<number> => purge((s) => s.accountId === accountId);
export const purgeAttachmentLink = (accountId: string, conversationId: string): Promise<number> => purge((s) => s.accountId === accountId && s.conversationId === conversationId);
export const purgeAttachmentMessage = (accountId: string, conversationId: string, messageId: string): Promise<number> => purge((s) => s.accountId === accountId && s.conversationId === conversationId && s.messageId === messageId);
export const purgeAttachmentSession = (accountId: string, sessionId: string): Promise<number> => purge((s) => s.accountId === accountId && s.sessionId === sessionId);
export const purgeExpiredAttachments = (now = Date.now()): Promise<number> => purge((s) => s.expiresAt !== null && s.expiresAt <= now);

/** Storage recovery drops ciphertext only. Mounted previews keep their pins. */
export async function evictAttachmentCache(): Promise<number> {
  return removeRecords((await records()).map((entry) => entry.id));
}
export async function attachmentCacheStats(): Promise<{ entries: number; bytes: number }> {
  const all = await records();
  return { entries: all.length, bytes: all.reduce((n, e) => n + e.size, 0) };
}
export async function pruneAttachmentCache(): Promise<number> {
  const all = (await records()).sort((a, b) => b.cachedAt - a.cachedAt);
  let bytes = 0;
  return removeRecords(all.filter((entry, index) => {
    bytes += entry.size;
    return index >= MAX_CACHED_ATTACHMENTS || bytes > MAX_CACHE_BYTES || (entry.expiresAt !== null && entry.expiresAt <= Date.now());
  }).map((entry) => entry.id));
}

export function useBlobAttachmentCache() {
  const owner = Symbol('attachment-preview-owner');
  let alive = true;
  let epoch = 0;
  const owned = new Map<string, string>(); // blobId -> scoped id, local to this consumer
  const blobPreviewUrls = reactive<Record<string, string>>({});
  const blobPreviewLoading = reactive<Record<string, boolean>>({});
  const downloadingBlobs = reactive<Record<string, boolean>>({});
  const blobAttachmentErrors = reactive<Record<string, string>>({});
  const refresh = () => {
    for (const [blobId, id] of owned) if (!urls.has(id)) { owned.delete(blobId); delete blobPreviewUrls[blobId]; }
  };
  owners.set(owner, refresh);
  function revokeObjectUrl(blobId: string): void {
    const id = owned.get(blobId);
    if (id) {
      const entry = urls.get(id);
      entry?.owners.delete(owner);
      if (entry && entry.owners.size === 0) revoke(id);
    }
    owned.delete(blobId);
    delete blobPreviewUrls[blobId];
  }
  function releaseObjectUrls(): void {
    ++epoch;
    for (const blobId of [...owned.keys()]) revokeObjectUrl(blobId);
    for (const state of [blobPreviewLoading, downloadingBlobs, blobAttachmentErrors]) for (const key of Object.keys(state)) delete state[key];
  }
  if (getCurrentScope()) onScopeDispose(() => { alive = false; releaseObjectUrls(); owners.delete(owner); });
  function objectUrlFor(blobId: string, blob: Blob, context: AttachmentCacheContext): string {
    const id = cacheId(blobId, context);
    if (owned.get(blobId) !== id) revokeObjectUrl(blobId);
    let entry = urls.get(id);
    if (!entry) { entry = { url: URL.createObjectURL(blob), scope: scopeOf(context), owners: new Set() }; urls.set(id, entry); }
    entry.owners.add(owner);
    owned.set(blobId, id);
    blobPreviewUrls[blobId] = entry.url;
    delete blobAttachmentErrors[blobId];
    return entry.url;
  }
  async function getCachedAttachment(blobId: string, context?: AttachmentCacheContext, metadata?: AttachmentMetadata): Promise<CachedVaultAttachment | null> {
    if (!context || !metadata || !valid(context)) return null;
    const start = revision;
    const currentEpoch = epoch;
    try {
      const db = await openDb();
      const entry = await new Promise<EncryptedAttachment | undefined>((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(cacheId(blobId, context));
        req.onsuccess = () => resolve(req.result as EncryptedAttachment | undefined);
        req.onerror = () => reject(req.error);
      });
      if (!entry) return null;
      await sodium.ready;
      if (!alive || epoch !== currentEpoch || !valid(context) || invalidated(context, start)) return null;
      const bytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, entry.ciphertext, aad(entry), sodium.from_hex(entry.nonceHex), sodium.from_hex(context.keyHex));
      try {
        return { ...metadata, blobId, blob: new Blob([new Uint8Array(bytes)], { type: metadata.mimetype }), cachedAt: entry.cachedAt };
      } finally { bytes.fill(0); }
    } catch { return null; } // Storage failure or authentication failure is a cache miss.
  }
  async function getCachedObjectUrl(blobId: string, context?: AttachmentCacheContext, metadata?: AttachmentMetadata): Promise<string | null> {
    const currentEpoch = epoch;
    const start = revision;
    const cached = await getCachedAttachment(blobId, context, metadata);
    if (!cached || !context || !alive || epoch !== currentEpoch || !valid(context) || invalidated(context, start)) return null;
    return objectUrlFor(blobId, cached.blob, context);
  }
  async function cacheAttachmentBlob(blobId: string, blob: Blob, metadata: AttachmentMetadata, context?: AttachmentCacheContext): Promise<string> {
    if (!context || !valid(context) || !alive) throw new Error('Attachment context is no longer available');
    if (metadata.size !== blob.size) throw new Error('Attachment size mismatch');
    const currentEpoch = epoch;
    const start = revision;
    const isCurrent = () => alive && epoch === currentEpoch && valid(context) && !invalidated(context, start);
    // The preview succeeds even when storage is full/disabled. No plaintext fallback on disk.
    const url = objectUrlFor(blobId, blob, context);
    try {
      if (blob.size > MAX_CACHE_BYTES) return url;
      await sodium.ready;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!isCurrent()) throw new Error('Attachment context changed');
      const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
      const entry: EncryptedAttachment = { ...scopeOf(context), id: cacheId(blobId, context), blobId, cachedAt: Date.now(), size: blob.size, nonceHex: sodium.to_hex(nonce), ciphertext: new Uint8Array() };
      try {
        entry.ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(bytes, aad(entry), null, nonce, sodium.from_hex(context.keyHex));
      } finally { bytes.fill(0); }
      const db = await openDb();
      if (!isCurrent()) throw new Error('Attachment context changed');
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Cache write failed'));
      });
      await pruneAttachmentCache();
    } catch { /* The component already owns a usable in-memory preview. */ }
    if (!isCurrent()) throw new Error('Attachment context changed');
    return url;
  }
  /** Retain every mounted attachment, not an LRU that revokes media still on screen. */
  function retainPreviews(blobIds: readonly string[]): void {
    const keep = new Set(blobIds);
    for (const blobId of [...owned.keys()]) if (!keep.has(blobId)) revokeObjectUrl(blobId);
  }
  return { blobPreviewUrls, blobPreviewLoading, blobAttachmentErrors, downloadingBlobs, getCachedAttachment, getCachedObjectUrl, cacheAttachmentBlob, revokeObjectUrl, releaseObjectUrls, retainPreviews, evictAttachmentCache, pruneAttachmentCache, attachmentCacheStats, purgeAttachmentAccount, purgeAttachmentLink, purgeAttachmentMessage, purgeAttachmentSession, purgeExpiredAttachments };
}

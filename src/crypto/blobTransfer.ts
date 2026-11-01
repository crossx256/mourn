/**
 * Vault Blob — Client-side encrypted file transfer
 *
 * Uses XChaCha20-Poly1305 (libsodium) to encrypt files before upload.
 * The server stores ONLY opaque bytes — no key, no filename, no MIME type.
 *
 * Flow:
 *   1. Sender picks file → encrypt locally with random key + nonce
 *   2. Upload encrypted blob to backend (server sees only noise) under a scope
 *      token: a 1:1 Link id, or `group:<suiteId>` for Suite attachments
 *   3. Send {blobId, keyHex, nonceHex, filename, size, mimetype} as E2EE message
 *   4. Recipient decrypts vault message → gets blobId + key
 *   5. Download encrypted blob from backend → decrypt locally with key + nonce
 *   6. Server auto-deletes blob after claim or 7-day TTL
 */

import sodium from 'libsodium-wrappers';
import { reactive } from 'vue';
import { getMobileSession, isMobileAuthRuntime } from 'src/services/mobileAuth';
import { fetchWithRetry } from 'src/utils/fetchWithRetry';

/**
 * Auth for the two raw `fetch()` blob requests.
 *
 * Every other mobile call goes through the axios client, which is BEARER-ONLY and
 * explicitly disables cookies (`withCredentials = false` so a stale WebView session
 * can never shadow the bearer identity — see boot/axios.ts). These two requests are
 * hand-rolled fetch calls, so they have to attach that identity themselves.
 *
 * They used to send `credentials: 'include'` and no Authorization header, which on
 * mobile means an ANONYMOUS request: the backend could not authenticate it, so the
 * CSRF check failed ("failed csrf" when sending/uploading) and downloads of received
 * images/files failed too. On desktop (Tauri) the native cookie store is still the
 * auth mechanism, so that path keeps `credentials: 'include'`.
 */
async function blobRequestAuth(csrfToken?: string): Promise<{
  credentials: RequestCredentials;
  headers: Record<string, string>;
}> {
  if (!isMobileAuthRuntime()) {
    return {
      credentials: 'include',
      headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
    };
  }

  const session = await getMobileSession();
  const token = session?.csrfToken || csrfToken;
  return {
    credentials: 'omit',
    headers: {
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
  };
}

export interface BlobTransferProgress {
  transferId: string;
  filename: string;
  size: number;
  mimetype: string;
  direction: 'upload' | 'download';
  progress: number; // 0–100
  state: 'encrypting' | 'uploading' | 'complete' | 'failed' | 'downloading' | 'decrypting';
  error?: string;
  blobUrl?: string; // Object URL for download
}

export interface BlobUploadScope {
  /** 'link' → 1:1 vault Link id · 'group' → Suite id */
  kind: 'link' | 'group';
  id: string;
}

export interface BlobAttachment {
  blobId: string;
  keyHex: string;
  nonceHex: string;
  filename: string;
  size: number;
  mimetype: string;
}

// Active transfers (reactive for UI)
export const blobTransfers = reactive<Record<string, BlobTransferProgress>>({});

/**
 * Encrypt and upload a file as an opaque blob.
 * Returns the attachment metadata to embed in an E2EE vault message.
 */
export async function encryptAndUploadBlob(
  file: File,
  scope: BlobUploadScope,
  csrfToken: string,
  apiBase: string,
  options?: { displayFilename?: string },
): Promise<BlobAttachment> {
  const displayFilename = options?.displayFilename?.trim() || file.name;
  await sodium.ready;

  const transferId = `blob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  blobTransfers[transferId] = {
    transferId,
    filename: displayFilename,
    size: file.size,
    mimetype: file.type || 'application/octet-stream',
    direction: 'upload',
    progress: 0,
    state: 'encrypting',
  };

  try {
    // Read file into ArrayBuffer
    const plainBytes = new Uint8Array(await file.arrayBuffer());

    // Generate random key + nonce
    const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

    // Encrypt
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plainBytes,
      null, // no additional data
      null, // no secret nonce (unused param)
      nonce,
      key,
    );

    blobTransfers[transferId].state = 'uploading';
    blobTransfers[transferId].progress = 10;

    // Upload encrypted blob
    const formData = new FormData();
    formData.append('blob', new Blob([new Uint8Array(ciphertext)]), 'blob');

    const auth = await blobRequestAuth(csrfToken);
    // A request dropped mid-flight (common for a large video on a mobile link)
    // used to surface as the browser's raw `TypeError: Failed to fetch` — the
    // "Yeh failed to fetch" report. Network-level failures are retried; an HTTP
    // response of any status is returned immediately for the caller to interpret.
    let resp: Response;
    try {
      resp = await fetchWithRetry(
        `${apiBase}/api/v1/vault/blob`,
        {
          method: 'POST',
          body: formData,
          credentials: auth.credentials,
          headers: {
            ...auth.headers,
            ...(scope.kind === 'group'
              ? { 'X-Vault-Group-Id': scope.id }
              : { 'X-Vault-Link-Id': scope.id }),
            'X-Vault-Blob-Size': String(ciphertext.byteLength),
          },
        },
        { attempts: 3, baseDelayMs: 500 },
      );
    } catch {
      throw new Error(
        'Upload failed — the connection dropped before it finished. Check your signal and try again.',
      );
    }

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(errData.error || `Upload failed (${resp.status})`);
    }

    const result = await resp.json();
    if (!result.success) {
      throw new Error(result.error || 'Upload failed');
    }

    blobTransfers[transferId].state = 'complete';
    blobTransfers[transferId].progress = 100;

    // Clean up transfer entry after a delay
    setTimeout(() => {
      delete blobTransfers[transferId];
    }, 2000);

    return {
      blobId: result.data.blobId,
      keyHex: sodium.to_hex(key),
      nonceHex: sodium.to_hex(nonce),
      filename: displayFilename,
      size: file.size,
      mimetype: file.type || 'application/octet-stream',
    };
  } catch (err) {
    blobTransfers[transferId].state = 'failed';
    blobTransfers[transferId].error = err instanceof Error ? err.message : 'Unknown error';
    throw err;
  }
}

/**
 * Download and decrypt a blob attachment.
 * Returns an Object URL that can be used for <a download> or <img src>.
 */
export async function downloadAndDecryptBlobData(
  attachment: BlobAttachment,
  apiBase: string,
  options?: { silent?: boolean },
): Promise<Blob> {
  await sodium.ready;

  const transferId = `blob_dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const showProgress = options?.silent !== true;

  if (showProgress) {
    blobTransfers[transferId] = {
      transferId,
      filename: attachment.filename,
      size: attachment.size,
      mimetype: attachment.mimetype,
      direction: 'download',
      progress: 0,
      state: 'downloading',
    };
  }

  try {
    const auth = await blobRequestAuth();
    const resp = await fetch(`${apiBase}/api/v1/vault/blob/${attachment.blobId}`, {
      credentials: auth.credentials,
      headers: auth.headers,
    });

    if (!resp.ok) {
      throw new Error(`Download failed (${resp.status})`);
    }

    if (showProgress) {
      blobTransfers[transferId]!.progress = 60;
      blobTransfers[transferId]!.state = 'decrypting';
    }

    const ciphertext = new Uint8Array(await resp.arrayBuffer());
    const key = sodium.from_hex(attachment.keyHex);
    const nonce = sodium.from_hex(attachment.nonceHex);

    // Decrypt
    const plainBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, // no secret nonce
      ciphertext,
      null, // no additional data
      nonce,
      key,
    );

    const blob = new Blob([new Uint8Array(plainBytes)], { type: attachment.mimetype });

    if (showProgress) {
      blobTransfers[transferId]!.state = 'complete';
      blobTransfers[transferId]!.progress = 100;

      setTimeout(() => {
        delete blobTransfers[transferId];
      }, 2000);
    }

    return blob;
  } catch (err) {
    if (showProgress) {
      blobTransfers[transferId]!.state = 'failed';
      blobTransfers[transferId]!.error = err instanceof Error ? err.message : 'Decryption failed';
    }
    throw err;
  }
}

export async function downloadAndDecryptBlob(
  attachment: BlobAttachment,
  apiBase: string,
): Promise<string> {
  const blob = await downloadAndDecryptBlobData(attachment, apiBase);
  return URL.createObjectURL(blob);
}

/**
 * Parse a vault message to check if it contains a blob attachment.
 * Returns the BlobAttachment if found, null otherwise.
 */
export function parseBlobAttachment(plaintext: string): BlobAttachment | null {
  try {
    // Blob attachments are embedded as JSON wrapped in a marker
    const marker = ':::VAULT_BLOB:::';
    const idx = plaintext.indexOf(marker);
    if (idx === -1) return null;

    const jsonStr = plaintext.slice(idx + marker.length).trim();
    const parsed = JSON.parse(jsonStr);

    if (
      parsed &&
      typeof parsed.blobId === 'string' &&
      typeof parsed.keyHex === 'string' &&
      typeof parsed.nonceHex === 'string' &&
      typeof parsed.filename === 'string'
    ) {
      return parsed as BlobAttachment;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate an attachment received as structured data (Suite wire payloads carry
 * the object directly instead of the text marker). Returns null for anything
 * malformed so a hostile payload can never reach the renderer.
 */
export function normalizeBlobAttachment(value: unknown): BlobAttachment | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BlobAttachment>;
  if (
    typeof candidate.blobId !== 'string' ||
    !candidate.blobId ||
    typeof candidate.keyHex !== 'string' ||
    !candidate.keyHex ||
    typeof candidate.nonceHex !== 'string' ||
    !candidate.nonceHex ||
    typeof candidate.filename !== 'string' ||
    typeof candidate.size !== 'number' ||
    !Number.isFinite(candidate.size)
  ) {
    return null;
  }
  return {
    blobId: candidate.blobId,
    keyHex: candidate.keyHex,
    nonceHex: candidate.nonceHex,
    filename: candidate.filename,
    size: candidate.size,
    mimetype:
      typeof candidate.mimetype === 'string' ? candidate.mimetype : 'application/octet-stream',
  };
}

/**
 * Build the message text that embeds a blob attachment.
 * The visible part shows the filename + size, the blob metadata follows the marker.
 */
export function buildBlobMessageText(attachment: BlobAttachment): string {
  const sizeStr = formatBlobSize(attachment.size);
  const visible = `📎 **${attachment.filename}** (${sizeStr})`;
  const meta = JSON.stringify({
    blobId: attachment.blobId,
    keyHex: attachment.keyHex,
    nonceHex: attachment.nonceHex,
    filename: attachment.filename,
    size: attachment.size,
    mimetype: attachment.mimetype,
  });
  return `${visible}\n:::VAULT_BLOB:::${meta}`;
}

/** Format a blob attachment size for display. */
export function formatBlobSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

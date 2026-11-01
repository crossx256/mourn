/**
 * Vault blob attachment viewer — preview, download and save for client-side
 * encrypted blob attachments.
 *
 * Shared by the 1:1 Vault chat and the Suite (group) chat so both surfaces
 * behave identically. The upload/handshake half lives in
 * `src/crypto/blobTransfer.ts`; decrypted object-URL caching lives in
 * `src/composables/useBlobAttachmentCache.ts`.
 */
import { reactive, watch } from 'vue';
import { useUiLifetime } from 'src/components/messaging/uiSafety';
import { useQuasar } from 'quasar';
import {
  downloadAndDecryptBlobData,
  normalizeBlobAttachment,
  parseBlobAttachment,
  type BlobAttachment,
} from 'src/crypto/blobTransfer';
import { useBlobAttachmentCache, type AttachmentCacheContext } from 'src/composables/useBlobAttachmentCache';
import { resolveApiUrl } from 'boot/axios';
import { isCapacitorRuntime } from 'src/utils/platform';
import { saveBlobToDevice } from 'src/services/mobileMedia';

export interface VaultBlobPreviewOptions {
  context: (attachment: BlobAttachment) => AttachmentCacheContext | null;
  /** Account generation + conversation. Changes release this mounted owner's previews. */
  scopeKey: () => string;
  autoDownload?: () => boolean;
}

export function mediaAutoDownloadEnabled(): boolean {
  try { return localStorage.getItem('mourn_auto_download_media') !== 'false'; }
  catch { return false; }
}

export function isBlobImage(mimetype?: string): boolean {
  return Boolean(mimetype?.startsWith('image/'));
}

export function isBlobVideo(mimetype?: string): boolean {
  return Boolean(mimetype?.startsWith('video/'));
}

export function isBlobAudio(mimetype?: string): boolean {
  return Boolean(mimetype?.startsWith('audio/'));
}

/** True when a (decrypted) message text carries the attachment marker. */
export function hasBlobAttachment(text: string): boolean {
  return text.includes(':::VAULT_BLOB:::');
}

/**
 * Validate an attachment that arrived as structured payload data (Suite wire
 * payloads carry the object directly instead of the text marker). Re-exported
 * from the wire-format module so both surfaces validate identically.
 */
export { normalizeBlobAttachment };

export function useVaultBlobAttachments(options: VaultBlobPreviewOptions) {
  const $q = useQuasar();
  const lifetime = useUiLifetime();
  const savedBlobSuccess = reactive<Record<string, boolean>>({});
  let generation = 0;
  const {
    blobPreviewUrls,
    blobPreviewLoading,
    blobAttachmentErrors,
    downloadingBlobs,
    getCachedObjectUrl,
    cacheAttachmentBlob,
    releaseObjectUrls,
    retainPreviews,
  } = useBlobAttachmentCache();
  watch(options.scopeKey, () => {
    ++generation;
    releaseObjectUrls();
    for (const key of Object.keys(savedBlobSuccess)) delete savedBlobSuccess[key];
  }, { flush: 'sync' });

  function operation(attachment: BlobAttachment) {
    const context = options.context(attachment);
    const started = generation;
    const scope = options.scopeKey();
    const current = () => lifetime.isAlive() && started === generation && scope === options.scopeKey() &&
      context !== null && JSON.stringify(options.context(attachment)) === JSON.stringify(context) &&
      (context.expiresAt === null || context.expiresAt > Date.now());
    return { context, current };
  }

  /** Decrypt + cache an image/video/audio preview so the bubble can render inline. */
  async function ensurePreview(attachment: BlobAttachment | null, explicit = false): Promise<void> {
    if (!attachment) return;
    const { context, current } = operation(attachment);
    if (!context || !current()) return;
    const key = attachment.blobId;
    if (blobPreviewUrls[key] || blobPreviewLoading[key]) return;
    if (
      !isBlobImage(attachment.mimetype) &&
      !isBlobVideo(attachment.mimetype) &&
      !isBlobAudio(attachment.mimetype)
    ) {
      return;
    }

    blobPreviewLoading[key] = true;
    try {
      const cachedUrl = await getCachedObjectUrl(key, context, attachment);
      if (!current() || cachedUrl) return;
      if (!explicit && !(options.autoDownload?.() ?? mediaAutoDownloadEnabled())) return;

      const blob = await downloadAndDecryptBlobData(attachment, resolveApiUrl(''), {
        silent: true,
      });
      if (!current()) return;
      await cacheAttachmentBlob(key, blob, attachment, context);
    } catch (err) {
      // Record it so the UI can show "no longer available" instead of a spinner
      // that never resolves (the server 404s a blob it has already deleted).
      if (!current()) return;
      blobAttachmentErrors[key] = err instanceof Error ? err.message : 'Unavailable';
      console.error('[BlobPreview] Failed', err);
    } finally {
      if (current()) blobPreviewLoading[key] = false;
    }
  }

  /** Explicit user save action: Tauri save dialog, browser download fallback. */
  async function saveAttachment(attachment: BlobAttachment | null): Promise<void> {
    if (!attachment) return;
    const { context, current } = operation(attachment);
    if (!context || !current()) return;
    const key = attachment.blobId;
    if (downloadingBlobs[key]) return; // already in progress
    downloadingBlobs[key] = true;

    try {
      let objectUrl = await getCachedObjectUrl(key, context, attachment);
      if (!current()) return;

      if (!objectUrl) {
        const blob = await downloadAndDecryptBlobData(attachment, resolveApiUrl(''));
        if (!current()) return;
        objectUrl = await cacheAttachmentBlob(key, blob, attachment, context);
      }

      if (!current()) return;
      const saved = await saveBlobObjectUrl(objectUrl, attachment.filename, attachment.mimetype, current);
      if (saved && current()) {
        savedBlobSuccess[key] = true;
        lifetime.later(() => {
          delete savedBlobSuccess[key];
        }, 3000);
      }
    } catch (err) {
      if (!current()) return;
      console.error('[BlobTransfer] Download failed', err);
      $q.notify({ type: 'negative', message: 'Failed to save file', timeout: 3000 });
    } finally {
      if (current()) downloadingBlobs[key] = false;
    }
  }

  async function saveBlobObjectUrl(
    objectUrl: string,
    filename: string,
    mimetype?: string,
    current: () => boolean = lifetime.isAlive,
  ): Promise<boolean> {
    const resp = await fetch(objectUrl);
    const blob = await resp.blob();
    if (!current()) return false;

    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const ext = filename.includes('.') ? (filename.split('.').pop() || '').toLowerCase() : '';
      const { save } = await import('@tauri-apps/plugin-dialog');
      if (!current()) return false;
      const filePath = await save({
        defaultPath: filename,
        filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
      });
      if (!filePath || !current()) return false;

      const { writeFile } = await import('@tauri-apps/plugin-fs');
      const arrayBuf = await blob.arrayBuffer();
      if (!current()) return false;
      await writeFile(filePath, new Uint8Array(arrayBuf));
      $q.notify({ type: 'positive', message: 'Saved', timeout: 1500 });
      return true;
    }

    // Capacitor (Android/iOS): an anchor `download` click is silently ignored by
    // the WebView, so "saving" did nothing while still reporting success. Write
    // through the Filesystem plugin instead, then offer the native share sheet.
    if (isCapacitorRuntime()) {
      const savedNatively = await saveBlobToDevice(blob, filename, mimetype || blob.type);
      $q.notify(
        savedNatively
          ? { type: 'positive', message: 'Saved to your device', timeout: 2000 }
          : { type: 'negative', message: 'Could not save the file', timeout: 3000 },
      );
      return savedNatively;
    }

    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.type = mimetype || blob.type;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    $q.notify({ type: 'positive', message: 'Download started', timeout: 1500 });
    return true;
  }

  return {
    blobPreviewUrls,
    blobPreviewLoading,
    blobAttachmentErrors,
    downloadingBlobs,
    savedBlobSuccess,
    isBlobImage,
    isBlobVideo,
    isBlobAudio,
    hasBlobAttachment,
    normalizeBlobAttachment,
    /** Prime the preview cache right after an upload (sender-side preview). */
    cacheAttachmentBlob,
    getCachedObjectUrl,
    /** Parse the `:::VAULT_BLOB:::` marker out of a decrypted message text. */
    attachmentFromText: parseBlobAttachment,
    releaseObjectUrls,
    retainPreviews,
    saveBlobObjectUrl,
    ensurePreview,
    saveAttachment,
  };
}

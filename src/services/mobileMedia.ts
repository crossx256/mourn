/**
 * Mobile media helpers — camera capture and saving attachments to the device.
 *
 * Capacitor-only. Every export is a safe no-op on web/Tauri (it reports
 * "unsupported" and the caller falls back to the existing behaviour), and the
 * CAP_* plugins are imported lazily so the desktop/web bundles never reference
 * them.
 *
 * Added Oct 2026 with the tester feedback batch:
 *  - "take a picture directly" from the composer
 *  - "failed to save file" when downloading an attachment on Android
 *    (an `<a download>` click is silently ignored by the Capacitor WebView)
 */

import { isCapacitorRuntime } from 'src/utils/platform';

export interface CapturedPhoto {
  /** Blob ready for the existing encrypted-upload pipeline. */
  blob: Blob;
  /** Generated filename, extension preserved. */
  filename: string;
  mimetype: string;
}

export type PhotoSource = 'camera' | 'photos';

function isNative(): boolean {
  return isCapacitorRuntime();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result || '');
      // readAsDataURL prefixes "data:<mime>;base64," — Filesystem wants the raw payload.
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Take a picture with the system camera (or pick an existing photo).
 * Returns null when unsupported, cancelled, or on error — callers must treat
 * null as "nothing to send", never as a failure to report.
 */
export async function capturePhoto(source: PhotoSource = 'camera'): Promise<CapturedPhoto | null> {
  if (!isNative()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      correctOrientation: true,
      saveToGallery: false,
    });
    if (!photo.base64String) return null;

    const binary = atob(photo.base64String);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const format = photo.format === 'jpg' ? 'jpeg' : photo.format;
    return {
      blob: new Blob([bytes], { type: `image/${format}` }),
      filename: `photo-${Date.now()}.${photo.format}`,
      mimetype: `image/${format}`,
    };
  } catch (err) {
    // A user tapping "cancel" rejects too — that is not an error.
    const message = String((err as Error)?.message ?? err).toLowerCase();
    if (message.includes('cancel')) return null;
    console.warn('[mobileMedia] Camera capture failed', err);
    return null;
  }
}

/**
 * Save an already-decrypted blob to the device.
 *
 * Writes into the app's Documents directory (no runtime permission needed, and
 * visible to the Files app / Android "Downloads"), then hands the file to the
 * share sheet on a best-effort basis so it can also land in Photos / Drive /
 * a chat app. Returns false when nothing was written.
 */
export async function saveBlobToDevice(
  blob: Blob,
  filename: string,
  mimetype?: string,
): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const data = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: filename,
      data,
      directory: Directory.Documents,
      recursive: true,
    });

    // Best-effort: offer the native share sheet so the user can also put it in
    // Photos/Drive. A failure here must not fail the save — the file is already
    // on disk.
    try {
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Documents });
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: filename, url: uri });
    } catch (shareErr) {
      console.warn('[mobileMedia] Share sheet unavailable, file saved to Documents', shareErr);
    }
    void mimetype;
    return true;
  } catch (err) {
    console.error('[mobileMedia] Failed to save blob to device', err);
    return false;
  }
}

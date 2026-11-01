import { ref } from 'vue';

/**
 * useTauriDownload — Tauri file dialog integration for downloads
 * Provides native file save dialog instead of automatic downloads
 *
 * Usage:
 *   const { saveFile, isProcessing } = useTauriDownload();
 *   await saveFile(fileBuffer, 'myfile.pdf', 'application/pdf');
 */
export function useTauriDownload() {
  const isProcessing = ref(false);

  /**
   * Detect if running in Tauri environment
   */
  function isTauriEnv(): boolean {
    if (typeof window === 'undefined') return false;
    const windowWithTauri = window as Window & {
      __TAURI__?: unknown;
      __TAURI_INTERNALS__?: unknown;
    };
    return !!(
      windowWithTauri.__TAURI__ ||
      windowWithTauri.__TAURI_INTERNALS__ ||
      navigator.userAgent?.includes('Tauri')
    );
  }

  /**
   * Show native file save dialog and download file to user-selected location
   * @param fileBuffer - The file data as Uint8Array or ArrayBuffer
   * @param defaultName - Suggested filename (e.g., 'blueprint.pdf')
   * @param mimeType - File MIME type (e.g., 'application/pdf')
   */
  async function saveFile(
    fileBuffer: Uint8Array | ArrayBuffer | Blob,
    defaultName: string = 'download',
    mimeType: string = 'application/octet-stream',
  ): Promise<boolean> {
    if (!isTauriEnv()) {
      console.warn('[Tauri Download] Not in Tauri environment. Falling back to browser download.');
      return fallbackBrowserDownload(fileBuffer, defaultName, mimeType);
    }

    isProcessing.value = true;
    try {
      // Import Tauri dialog module
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeFile } = await import('@tauri-apps/plugin-fs');

      // Extract file extension
      const ext = (defaultName.includes('.') ? defaultName.split('.').pop() : 'bin') || 'bin';
      const fileName = defaultName.includes('.') ? defaultName : `${defaultName}.${ext}`;

      // Show native save dialog
      const filePath = await save({
        defaultPath: fileName,
        filters: [
          {
            name: `${ext.toUpperCase()} File`,
            extensions: [`${ext}`],
          },
          {
            name: 'All Files',
            extensions: [],
          },
        ],
      });

      if (!filePath) {
        // User cancelled the dialog
        console.log('[Tauri Download] User cancelled file save dialog.');
        return false;
      }

      // Convert Blob to bytes if necessary
      let bytes: Uint8Array;
      if (fileBuffer instanceof Blob) {
        const arrayBuffer = await fileBuffer.arrayBuffer();
        bytes = new Uint8Array(arrayBuffer);
      } else if (fileBuffer instanceof ArrayBuffer) {
        bytes = new Uint8Array(fileBuffer);
      } else {
        bytes = fileBuffer;
      }

      // Write file to selected location
      await writeFile(filePath, bytes);

      console.log('[Tauri Download] File saved successfully:', filePath);
      return true;
    } catch (error) {
      console.error('[Tauri Download] Error saving file:', error);
      // Fall back to browser download on error
      return fallbackBrowserDownload(fileBuffer, defaultName, mimeType);
    } finally {
      isProcessing.value = false;
    }
  }

  /**
   * Browser fallback for non-Tauri environments
   */
  function fallbackBrowserDownload(
    fileBuffer: Uint8Array | ArrayBuffer | Blob,
    defaultName: string,
    mimeType: string,
  ): boolean {
    try {
      let blob: Blob;

      if (fileBuffer instanceof Blob) {
        blob = fileBuffer;
      } else if (fileBuffer instanceof ArrayBuffer) {
        blob = new Blob([fileBuffer], { type: mimeType });
      } else {
        // TypeScript cast: Uint8Array unwrapped to buffer (ArrayBuffer safe)
        const buffer = fileBuffer.buffer.slice(
          fileBuffer.byteOffset,
          fileBuffer.byteOffset + fileBuffer.byteLength,
        ) as ArrayBuffer;
        blob = new Blob([buffer], { type: mimeType });
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = defaultName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log('[Browser Download] File downloaded:', defaultName);
      return true;
    } catch (error) {
      console.error('[Browser Download] Error:', error);
      return false;
    }
  }

  return {
    saveFile,
    isProcessing: readonly(isProcessing),
    isTauriEnv,
  };
}

import { readonly } from 'vue';

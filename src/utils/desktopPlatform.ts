/**
 * Desktop platform helpers.
 *
 * Mourn Desktop ships for Windows and Linux only (macOS support was removed),
 * and a few app-lifecycle behaviors are Windows-only. `navigator.userAgent` is
 * the only platform signal the renderer has without pulling in an extra Tauri
 * plugin: WebKitGTK (Linux) reports "Linux", WebView2 (Windows) reports
 * "Windows".
 */

export function isLinuxDesktop(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);
}

/**
 * "Stay minimized" (close-to-tray instead of quitting) is Windows-only: the
 * Linux tray/close-hide path is unreliable, so the window could be hidden with
 * no way to bring it back. The native side enforces the same rule, and the
 * toggle is disabled in Settings on Linux.
 */
export function isStayMinimizedSupported(): boolean {
  return !isLinuxDesktop();
}

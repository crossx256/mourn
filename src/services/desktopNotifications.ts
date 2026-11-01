/**
 * Native Notification Service
 * Sound + app-icon badge bridge for the native shells.
 *
 * Native notification UI is intentionally NOT raised here. On desktop the app
 * plays a sound only (a window that is open does not need a toast); on mobile
 * the same rule holds — while the app is in the foreground we play the sound and
 * update the badge, and the OS-level notification is delivered by a PUSH
 * message, which is the only thing that can reach a backgrounded/killed app.
 *
 * Badge support:
 *   desktop  Rust `set_badge_count` (Windows taskbar / Linux launcher)
 *   mobile   @capawesome/capacitor-badge (numeric badge on the launcher icon,
 *            only when the launcher actually supports badges)
 */

import { playNotificationSound } from 'src/utils/notificationSound';
import { isCapacitorRuntime, isTauriRuntime } from 'src/utils/platform';

export interface DesktopNotificationPayload {
  linkId: string;
  senderName: string;
  senderUserId: string;
  messagePreview?: string;
  unreadCount?: number;
}

/**
 * Initialize the notification system.
 * Native desktop notifications are intentionally disabled; this only
 * ensures the notification sound helper is ready.
 */
export async function initializeDesktopNotifications(
  _onNotificationClick: (payload: DesktopNotificationPayload) => Promise<void>,
): Promise<void> {
  try {
    void _onNotificationClick;
    console.log('[Native Notifications] Initialized in sound-only mode');
  } catch (err) {
    console.error('[Native Notifications] Initialization failed:', err);
  }
}

/**
 * Show a notification for incoming message.
 * Sound-only mode: plays the notification sound and skips native UI.
 *
 * @param payload - Notification data (sender, link, etc)
 */
export async function showMessageNotification(payload: DesktopNotificationPayload): Promise<void> {
  try {
    await playNotificationSound();

    console.log('[Native Notifications] Played sound for message from', payload.senderName);
  } catch (err) {
    console.error('[Native Notifications] Failed to play notification sound:', err);
  }
}

/**
 * Update the unread badge count (taskbar / launcher icon).
 * Called whenever message count changes.
 *
 * @param count - Number of unread messages
 */
export async function updateUnreadBadge(count: number): Promise<void> {
  try {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_badge_count', { count });
      console.log('[Native Notifications] Badge updated to', count);
      return;
    }

    if (isCapacitorRuntime()) {
      const { Badge } = await import('@capawesome/capacitor-badge');
      // Numeric badges are launcher-dependent on Android (Samsung/Xiaomi/etc.);
      // silently skip when the launcher cannot show one rather than throwing.
      if (!(await Badge.isSupported())) return;
      if (count > 0) {
        await Badge.set({ count });
      } else {
        await Badge.clear();
      }
    }
  } catch (err) {
    console.warn('[Native Notifications] Failed to update badge:', err);
  }
}

/**
 * Clean up notification system.
 * Called on app shutdown or logout.
 */
export function cleanupDesktopNotifications(): void {
  console.log('[Native Notifications] Cleaned up');
}

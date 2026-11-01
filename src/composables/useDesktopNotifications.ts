/**
 * Desktop Notifications Composable
 * Integrates native desktop notifications with Mourn's messaging system.
 * Handles:
 * - Initializing notification system on app startup
 * - Sending notifications when offline users receive messages
 * - Triggering WebSocket reconnect on notification click
 * - Updating unread badge count
 */

import { onMounted, onBeforeUnmount, ref } from 'vue';
import {
  initializeDesktopNotifications,
  showMessageNotification,
  updateUnreadBadge,
  cleanupDesktopNotifications,
  type DesktopNotificationPayload,
} from '../services/desktopNotifications';

export interface UseDesktopNotificationsOptions {
  onNotificationClick?: (payload: DesktopNotificationPayload) => Promise<void>;
}

export function useDesktopNotifications(options: UseDesktopNotificationsOptions = {}) {
  const isInitialized = ref(false);
  const isDesktop = ref(false);

  /**
   * Check if we're running in Tauri (desktop app).
   */
  function detectDesktop(): boolean {
    return (
      typeof window !== 'undefined' &&
      ('__TAURI__' in window ||
        '__TAURI_INTERNALS__' in window ||
        navigator.userAgent.includes('Tauri'))
    );
  }

  /**
   * Initialize the notification system.
   * Must be called once on app startup.
   */
  async function init(): Promise<void> {
    if (!detectDesktop()) {
      return;
    }

    isDesktop.value = true;

    const handleNotificationClick = options.onNotificationClick || (async () => {});

    try {
      await initializeDesktopNotifications(handleNotificationClick);
      isInitialized.value = true;
    } catch (err) {
      console.error('[useDesktopNotifications] Initialization failed:', err);
    }
  }

  /**
   * Show a notification when a message arrives for an offline user.
   * Should be called when handleIncomingMessage() successfully decrypts and stores a message.
   */
  async function showNotification(payload: DesktopNotificationPayload): Promise<void> {
    if (!isDesktop.value || !isInitialized.value) {
      return;
    }

    try {
      await showMessageNotification(payload);
    } catch (err) {
      console.error('[useDesktopNotifications] Failed to show notification:', err);
    }
  }

  /**
   * Update the unread message badge.
   * Call this whenever the total unread count changes.
   */
  async function updateBadge(count: number): Promise<void> {
    if (!isDesktop.value) {
      return;
    }

    try {
      await updateUnreadBadge(count);
    } catch (err) {
      console.warn('[useDesktopNotifications] Failed to update badge:', err);
    }
  }

  /**
   * Clean up resources on app shutdown or logout.
   */
  function cleanup(): void {
    if (isInitialized.value) {
      cleanupDesktopNotifications();
      isInitialized.value = false;
    }
  }

  // Lifecycle: Initialize on mount, clean up on unmount
  onMounted(() => {
    init();
  });

  onBeforeUnmount(() => {
    cleanup();
  });

  return {
    isInitialized,
    isDesktop,
    init,
    showNotification,
    updateBadge,
    cleanup,
  };
}

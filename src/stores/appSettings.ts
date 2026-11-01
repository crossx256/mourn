import { defineStore } from 'pinia';
import { isStayMinimizedSupported } from 'src/utils/desktopPlatform';
import { dismissArrivalBanner } from 'src/composables/useArrivalBanner';

const DISCORD_RPC_ENABLED_KEY = 'mourn_app_discord_rpc_enabled';
const RANDOM_SYSTEM_MESSAGES_ENABLED_KEY = 'mourn_app_random_system_messages_enabled';
const STAY_MINIMIZED_KEY = 'mourn_app_stay_minimized';
const IN_APP_MESSAGE_BANNER_KEY = 'mourn_app_in_app_message_banner';

export type DiscordRpcStatus = 'idle' | 'connecting' | 'connected' | 'failed';

function readStoredBoolean(key: string, fallback = false): boolean {
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    /* ignore storage failures */
  }
}

export const useAppSettingsStore = defineStore('appSettings', {
  state: () => ({
    discordRpcEnabled: false,
    randomSystemMessagesEnabled: true,
    /**
     * Show a Discord-style transient banner inside the app when a message arrives
     * while Mourn is in the foreground. Defaults on; the tray notification still
     * covers the backgrounded case, and this never posts a tray entry of its own.
     */
    inAppMessageBanner: true,
    // Desktop app lifecycle preferences. Both default OFF and persist to the
    // device via localStorage so they survive restarts.
    stayMinimized: false,
    hydrated: false,
    discordRpcStatus: 'idle' as DiscordRpcStatus,
    discordRpcMessage: '',
  }),

  actions: {
    hydrate() {
      if (this.hydrated) return;

      this.discordRpcEnabled = readStoredBoolean(DISCORD_RPC_ENABLED_KEY, false);
      this.randomSystemMessagesEnabled = readStoredBoolean(
        RANDOM_SYSTEM_MESSAGES_ENABLED_KEY,
        true,
      );
      this.stayMinimized = readStoredBoolean(STAY_MINIMIZED_KEY, false);
      this.inAppMessageBanner = readStoredBoolean(IN_APP_MESSAGE_BANNER_KEY, true);
      // Windows-only: on Linux the close-to-tray path is unreliable, so the
      // preference is always forced off (and never re-enabled by a stale
      // stored value from an older build).
      if (!isStayMinimizedSupported()) this.stayMinimized = false;
      this.hydrated = true;
    },

    setDiscordRpcEnabled(enabled: boolean) {
      this.discordRpcEnabled = enabled;
      this.hydrated = true;
      writeStoredBoolean(DISCORD_RPC_ENABLED_KEY, enabled);
    },

    setRandomSystemMessagesEnabled(enabled: boolean) {
      this.randomSystemMessagesEnabled = enabled;
      this.hydrated = true;
      writeStoredBoolean(RANDOM_SYSTEM_MESSAGES_ENABLED_KEY, enabled);
    },

    setInAppMessageBanner(enabled: boolean) {
      this.inAppMessageBanner = enabled;
      this.hydrated = true;
      writeStoredBoolean(IN_APP_MESSAGE_BANNER_KEY, enabled);
      // Turning it off should also clear one already on screen. STATIC import: the
      // banner module holds singleton state, and pulling it in dynamically from here
      // while the component imports it statically can yield two module instances —
      // the state is then set on one and rendered from the other, i.e. no banner.
      if (!enabled) dismissArrivalBanner();
    },

    setStayMinimized(enabled: boolean) {
      // Fail-closed on unsupported platforms: keep the persisted value and the
      // native mirror in agreement.
      if (enabled && !isStayMinimizedSupported()) enabled = false;
      this.stayMinimized = enabled;
      this.hydrated = true;
      writeStoredBoolean(STAY_MINIMIZED_KEY, enabled);
    },

    setDiscordRpcStatus(status: DiscordRpcStatus, message = '') {
      this.discordRpcStatus = status;
      this.discordRpcMessage = message;
    },
  },
});

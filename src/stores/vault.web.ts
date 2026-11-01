import { defineStore } from 'pinia';

export type RetentionMode = 'persistent' | 'ephemeral_time' | 'ephemeral_session';
export type MessageStatus = 'SENDING' | 'SENT' | 'FAILED_NETWORK' | 'FAILED_PROTOCOL';

export interface ChatSettings {
  mode: RetentionMode;
  retainHours?: number;
  /** Per-chat mute: suppress notification sounds for this chat when true. */
  muted?: boolean;
}

export interface ClientMessage {
  id: string;
  text: string;
  linkId: string;
  senderId?: string;
  recipientId?: string;
  isSender: boolean;
  timestamp: number;
  isUnsafe?: boolean;
  reactions?: Record<string, string[]>;
  status?: MessageStatus;
}

export const useVaultStore = defineStore('vault', {
  state: () => ({
    isInitialized: false,
    deviceId: null as string | null,
    connectionError: null as string | null,
    activeSettings: {} as Record<string, ChatSettings>,
    messages: {} as Record<string, ClientMessage[]>,
    compromisedLinks: {} as Record<string, boolean>,
    overrideSecurity: {} as Record<string, boolean>,
    unreadLinks: {} as Record<string, boolean>,
    unreadMessageCounts: {} as Record<string, number>,
    activeLinkId: null as string | null,
    deliveryStatusUnavailable: true,
  }),
  getters: {
    unreadCount(state): number {
      return Object.values(state.unreadMessageCounts).reduce(
        (total, count) => total + (count || 0),
        0,
      );
    },
    isLinkCompromised:
      (state) =>
      (linkId: string): boolean =>
        state.compromisedLinks[linkId] === true,
  },
  actions: {
    async initialize(): Promise<void> {},
    async clearVaultState(): Promise<void> {
      this.isInitialized = false;
      this.deviceId = null;
      this.connectionError = null;
      this.messages = {};
      this.unreadLinks = {};
      this.unreadMessageCounts = {};
      this.activeLinkId = null;
    },
  },
});

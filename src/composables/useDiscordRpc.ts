import { useNativeShell } from './useNativeShell';
import { useAppSettingsStore } from 'src/stores/appSettings';

export const DISCORD_RPC_CLIENT_ID = import.meta.env.VITE_DISCORD_RPC_CLIENT_ID || '';

const DISCORD_RPC_STATE = '-vita nova-';
const DISCORD_RPC_DETAILS = '-------';

/**
 * Launch-time Discord RPC is a race: if the user starts Mourn before Discord,
 * or Discord is still booting, the one attempt at launch fails. Retry with
 * backoff instead of leaving the presence dead until the setting is toggled,
 * and re-attempt when the window regains focus (the moment a user would notice
 * Discord is now open).
 */
const RETRY_DELAYS_MS = [30_000, 120_000, 300_000];

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempts = 0;
let resumeListenerAttached = false;

function clearRetryTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

export interface DiscordRpcResult {
  ok: boolean;
  message: string;
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export function useDiscordRpc() {
  const { isTauri } = useNativeShell();
  const appSettingsStore = useAppSettingsStore();

  function desktopOnlyFailure(action: 'start' | 'stop'): DiscordRpcResult {
    const message =
      action === 'start'
        ? 'discord rpc requires the desktop app'
        : 'discord rpc is not active in this runtime';
    appSettingsStore.setDiscordRpcStatus('failed', message);
    return { ok: false, message };
  }

  function scheduleRetry(): void {
    if (retryAttempts >= RETRY_DELAYS_MS.length) return;
    const delay = RETRY_DELAYS_MS[retryAttempts] ?? 0;
    retryAttempts += 1;
    clearRetryTimer();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!appSettingsStore.discordRpcEnabled) return;
      void startDiscordRpc();
    }, delay);

    // One listener for the lifetime of the app: coming back to the window is
    // when a user notices Discord is open now.
    if (!resumeListenerAttached && typeof window !== 'undefined') {
      resumeListenerAttached = true;
      window.addEventListener('focus', () => {
        if (!appSettingsStore.discordRpcEnabled) return;
        if (appSettingsStore.discordRpcStatus !== 'failed') return;
        clearRetryTimer();
        retryAttempts = 0;
        void startDiscordRpc();
      });
    }
  }

  async function startDiscordRpc(
    clientId: string = DISCORD_RPC_CLIENT_ID,
    state = DISCORD_RPC_STATE,
    details = DISCORD_RPC_DETAILS,
  ): Promise<DiscordRpcResult> {
    if (!isTauri.value) return desktopOnlyFailure('start');

    if (!clientId) {
      const message = 'missing discord application id';
      appSettingsStore.setDiscordRpcStatus('failed', message);
      return { ok: false, message };
    }

    try {
      await tauriInvoke('start_discord_rpc', { clientId, state, details });
      clearRetryTimer();
      retryAttempts = 0;
      appSettingsStore.setDiscordRpcStatus('connected', 'rpc connected');
      return { ok: true, message: 'rpc connected' };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = raw || 'failed to connect';
      appSettingsStore.setDiscordRpcStatus('failed', message);
      scheduleRetry();
      return { ok: false, message };
    }
  }

  async function stopDiscordRpc(): Promise<DiscordRpcResult> {
    clearRetryTimer();
    retryAttempts = 0;
    if (!isTauri.value) return desktopOnlyFailure('stop');

    try {
      await tauriInvoke('stop_discord_rpc');
      appSettingsStore.setDiscordRpcStatus('idle', 'rpc disabled');
      return { ok: true, message: 'rpc disabled' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to disconnect';
      appSettingsStore.setDiscordRpcStatus('failed', message);
      return { ok: false, message };
    }
  }

  async function syncDiscordRpc(enabled: boolean): Promise<DiscordRpcResult> {
    if (enabled) {
      retryAttempts = 0;
      return startDiscordRpc();
    }

    return stopDiscordRpc();
  }

  async function reconnectDiscordRpc(): Promise<DiscordRpcResult> {
    if (!isTauri.value) return desktopOnlyFailure('start');

    await stopDiscordRpc();
    retryAttempts = 0;
    return startDiscordRpc();
  }

  return {
    startDiscordRpc,
    stopDiscordRpc,
    syncDiscordRpc,
    reconnectDiscordRpc,
  };
}

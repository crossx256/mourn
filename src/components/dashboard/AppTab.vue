<template>
  <div>
    <div class="flex justify-between items-start mb-6 gap-4">
      <div>
        <div class="dash-back-inline">
          <q-btn
            v-if="$q?.screen?.lt?.md"
            round
            flat
            icon="mdi-arrow-left"
            to="/"
            color="primary"
            size="md"
            dense
            class="dash-back-btn"
            aria-label="back to home"
          />
          <h1 class="text-xl text-primary m-0 tracking-wide lowercase font-bold leading-none">
            app
          </h1>
        </div>
        <p class="text-muted text-xs m-0">desktop-only app behavior and native presence</p>
      </div>
    </div>

    <q-card flat bordered dark class="dash-card mb-5 app-card" data-field="discord-rpc">
      <q-card-section>
        <div class="dash-section-title">discord rich presence</div>
        <p class="text-muted text-xs mb-4">
          broadcast a quiet status to discord while mourn is open on this device.
        </p>

        <div class="app-rpc-row">
          <div class="app-rpc-copy">
            <div class="app-rpc-label">enable rich presence</div>
            <div class="app-rpc-desc">
              shows a minimalist activity such as in the shadows or reading the archives.
            </div>
          </div>

          <q-toggle
            :model-value="appSettingsStore.discordRpcEnabled"
            :disable="applyingDiscordRpc || !isTauri"
            color="primary"
            keep-color
            @update:model-value="handleDiscordRpcToggle"
          />
        </div>

        <div class="app-rpc-status-wrap">
          <div class="app-rpc-status" :class="rpcStatusClass">
            <span class="app-rpc-status-dot" :class="rpcDotClass"></span>
            <span>{{ rpcStatusLabel }}</span>
          </div>

          <q-btn
            v-if="appSettingsStore.discordRpcStatus === 'failed'"
            flat
            dense
            no-caps
            class="app-rpc-reconnect"
            :loading="reconnectingDiscordRpc"
            @click="handleReconnectDiscordRpc"
          >
            reconnect
          </q-btn>
        </div>

        <!-- The stored failure reason was never surfaced, so a broken RPC link
             looked identical to a missing one ("failed to connect"). Show it. -->
        <div
          v-if="
            appSettingsStore.discordRpcStatus === 'failed' && appSettingsStore.discordRpcMessage
          "
          class="app-rpc-reason"
        >
          {{ appSettingsStore.discordRpcMessage }}
        </div>

        <div class="mt-4 grid gap-3 text-xs text-muted">
          <div class="rounded border border-solid border-dash-border bg-dash-bg px-4 py-3">
            <span class="text-primary font-bold">platforms:</span> windows and linux via discord
            ipc.
          </div>
          <div class="rounded border border-solid border-dash-border bg-dash-bg px-4 py-3">
            <span class="text-primary font-bold">behavior:</span> if discord is offline, the
            preference stays saved and the app will try again next launch.
          </div>
          <div class="rounded border border-solid border-dash-border bg-dash-bg px-4 py-3">
            <span class="text-primary font-bold">visibility:</span> connected means ipc is live.
            discord still requires <span class="font-bold">activity privacy</span> enabled and a
            non-invisible status to display presence.
          </div>
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card app-card" data-field="hardware-acceleration">
      <q-card-section>
        <div class="dash-section-title">hardware acceleration</div>
        <p class="text-muted text-xs mb-4">
          let the operating system and webview use GPU acceleration. changing this restarts mourn.
        </p>

        <div class="app-rpc-row">
          <div class="app-rpc-copy">
            <div class="app-rpc-label">prefer hardware acceleration</div>
            <div class="app-rpc-desc">
              recommended. GPU selection is controlled by your OS, driver, and hybrid-graphics
              policy; this setting cannot force a discrete GPU.
            </div>
          </div>
          <q-toggle
            :model-value="hardwareAccelerationEnabled"
            :disable="!isTauri || !graphicsToggleSupported || applyingGraphicsPreference"
            color="primary"
            keep-color
            @update:model-value="handleHardwareAccelerationToggle"
          />
        </div>

        <div v-if="!graphicsToggleSupported" class="mt-4 text-xs text-muted">
          WKWebView does not provide a supported per-app hardware acceleration toggle on macOS.
        </div>
        <div v-else class="mt-4 text-xs text-muted">
          Disable this only as a compatibility fallback for broken GPU drivers or remote sessions.
          Software rendering can use substantially more CPU.
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mt-5 app-card" data-field="in-app-message-banner">
      <q-card-section>
        <div class="dash-section-title">in-app message banner</div>
        <p class="text-muted text-xs mb-4">
          announce a message that arrives while you are inside the app.
        </p>

        <div class="app-rpc-row">
          <div class="app-rpc-copy">
            <div class="app-rpc-label">show message banners in the app</div>
            <div class="app-rpc-desc">
              when a message lands while mourn is open, a banner drops in from the top with the
              sender and the message. tapping it opens that chat. it disappears on its own when the
              timer bar runs out — while the app is closed you still get a normal notification.
            </div>
          </div>

          <q-toggle
            :model-value="appSettingsStore.inAppMessageBanner"
            color="primary"
            keep-color
            @update:model-value="handleInAppMessageBannerToggle"
          />
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mt-5 app-card" data-field="random-system-messages">
      <q-card-section>
        <div class="dash-section-title">random system messages</div>
        <p class="text-muted text-xs mb-4">
          control whether the landing page displays the occasional system quote drop.
        </p>

        <div class="app-rpc-row">
          <div class="app-rpc-copy">
            <div class="app-rpc-label">show random system messages</div>
            <div class="app-rpc-desc">
              when disabled, the app stops showing the main-page quote feed until you turn it back
              on.
            </div>
          </div>

          <q-toggle
            :model-value="appSettingsStore.randomSystemMessagesEnabled"
            color="primary"
            keep-color
            @update:model-value="handleRandomSystemMessagesToggle"
          />
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mt-5 app-card" data-field="stay-minimized">
      <q-card-section>
        <div class="dash-section-title">stay minimized</div>
        <p class="text-muted text-xs mb-4">
          keep mourn running in the background when you close the window.
        </p>

        <div class="app-rpc-row">
          <div class="app-rpc-copy">
            <div class="app-rpc-label">close to background</div>
            <div class="app-rpc-desc">
              clicking the close button hides mourn to the system tray instead of quitting, so you
              keep receiving message notifications until you exit from the tray.
            </div>
          </div>

          <q-toggle
            :model-value="appSettingsStore.stayMinimized"
            :disable="!isTauri || !stayMinimizedSupported"
            color="primary"
            keep-color
            @update:model-value="handleStayMinimizedToggle"
          />
        </div>

        <div class="mt-4 grid gap-3 text-xs text-muted">
          <div
            v-if="!stayMinimizedSupported"
            class="rounded border border-solid border-dash-border bg-dash-bg px-4 py-3"
          >
            <span class="text-primary font-bold">unavailable on linux:</span> closing the window
            always quits mourn on linux — the close-to-tray path is unreliable there, so this
            setting is windows-only.
          </div>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useAppSettingsStore } from 'src/stores/appSettings';
import { useDiscordRpc } from 'src/composables/useDiscordRpc';
import { useNativeShell } from 'src/composables/useNativeShell';
import { isStayMinimizedSupported } from 'src/utils/desktopPlatform';
import { showArrivalBanner } from 'src/composables/useArrivalBanner';
// import { unlockAudio, playNotificationSound } from 'src/utils/notificationSound';

const $q = useQuasar();
const appSettingsStore = useAppSettingsStore();
const { syncDiscordRpc, reconnectDiscordRpc } = useDiscordRpc();
const { isTauri } = useNativeShell();

// "Stay minimized" is Windows-only (see src/utils/desktopPlatform.ts).
const stayMinimizedSupported = computed(() => isStayMinimizedSupported());

// Raw Tauri 2 IPC bridge for the app-lifecycle commands. Only present in the
// desktop build; guarded by `isTauri` in the toggles that call it.
function tauriInvoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internals = (window as any).__TAURI_INTERNALS__;
  if (!internals) return Promise.reject('not in tauri');
  return internals.invoke(cmd, args) as Promise<T>;
}

const applyingDiscordRpc = ref(false);
const reconnectingDiscordRpc = ref(false);
const applyingGraphicsPreference = ref(false);
const hardwareAccelerationEnabled = ref(true);
const graphicsToggleSupported = ref(false);
// const testingSound = ref(false);

const rpcStatusLabel = computed(() => {
  if (appSettingsStore.discordRpcStatus === 'connected') return 'rpc connected';
  if (appSettingsStore.discordRpcStatus === 'failed') return 'failed to connect';
  return 'rpc disabled';
});

const rpcStatusClass = computed(() => {
  if (appSettingsStore.discordRpcStatus === 'connected') return 'app-rpc-status--connected';
  if (appSettingsStore.discordRpcStatus === 'failed') return 'app-rpc-status--failed';
  return 'app-rpc-status--disabled';
});

const rpcDotClass = computed(() => {
  if (appSettingsStore.discordRpcStatus === 'connected') return 'app-rpc-status-dot--connected';
  if (appSettingsStore.discordRpcStatus === 'failed') return 'app-rpc-status-dot--failed';
  return 'app-rpc-status-dot--disabled';
});

onMounted(async () => {
  if (!isTauri.value) return;
  try {
    const status = await tauriInvoke<{
      hardwareAccelerationPreference?: boolean;
      graphicsToggleSupported?: boolean;
    }>('get_system_status');
    // A status-read failure (or a command payload that drifts from the
    // renderer's shape) must never leave this toggle permanently disabled — it
    // is the only way a user can opt out of a broken GPU driver. Fall back to
    // "supported / hardware preferred" and let the toggle be used.
    hardwareAccelerationEnabled.value =
      typeof status.hardwareAccelerationPreference === 'boolean'
        ? status.hardwareAccelerationPreference
        : true;
    graphicsToggleSupported.value =
      typeof status.graphicsToggleSupported === 'boolean' ? status.graphicsToggleSupported : true;
  } catch (error) {
    console.warn('[AppTab] Failed to read graphics preference:', error);
    graphicsToggleSupported.value = true;
  }
});

async function handleHardwareAccelerationToggle(enabled: boolean) {
  if (applyingGraphicsPreference.value) return;
  applyingGraphicsPreference.value = true;
  try {
    await tauriInvoke('set_hardware_acceleration_preference', { enabled });
    hardwareAccelerationEnabled.value = enabled;
    $q.notify({
      type: 'info',
      message: enabled
        ? 'restarting with hardware acceleration preferred'
        : 'restarting with software rendering',
      timeout: 1800,
      position: 'bottom-right',
    });
    window.setTimeout(async () => {
      try {
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      } catch (error) {
        applyingGraphicsPreference.value = false;
        console.warn('[AppTab] Failed to restart after graphics change:', error);
        // The preference is written but the restart did not happen, so the
        // change is not live yet. Say so instead of failing silently.
        $q.notify({
          type: 'warning',
          message: 'graphics preference saved — close and reopen mourn to apply it',
          timeout: 4000,
          position: 'bottom-right',
        });
      }
    }, 500);
  } catch (error) {
    applyingGraphicsPreference.value = false;
    $q.notify({ type: 'negative', message: String(error), position: 'bottom-right' });
  }
}

async function handleDiscordRpcToggle(enabled: boolean) {
  if (applyingDiscordRpc.value) {
    return;
  }

  appSettingsStore.setDiscordRpcEnabled(enabled);
  applyingDiscordRpc.value = true;

  try {
    const result = await syncDiscordRpc(enabled);

    if (result.ok) {
      appSettingsStore.setDiscordRpcStatus(enabled ? 'connected' : 'idle', result.message);
      $q.notify({
        type: 'positive',
        message: enabled ? 'rpc connected' : 'rpc disabled',
        position: 'bottom-right',
      });
      return;
    }

    appSettingsStore.setDiscordRpcStatus('failed', result.message);
    $q.notify({
      type: 'negative',
      message: result.message || 'failed to connect',
      position: 'bottom-right',
    });
  } finally {
    applyingDiscordRpc.value = false;
  }
}

function handleInAppMessageBannerToggle(enabled: boolean) {
  appSettingsStore.setInAppMessageBanner(enabled);
  $q.notify({
    type: enabled ? 'positive' : 'info',
    message: enabled ? 'in-app banners enabled' : 'in-app banners disabled',
    position: 'bottom-right',
  });

  // Preview the real thing when turning it on, so the setting is not a guess.
  // STATIC import (see the note in the store): a dynamic import here can create a
  // second instance of the banner module and the banner never shows.
  if (enabled) {
    showArrivalBanner({
      id: `preview-${Date.now()}`,
      title: 'Mourn',
      body: 'This is how a new message will look inside the app.',
      durationMs: 4000,
    });
  }
}

function handleRandomSystemMessagesToggle(enabled: boolean) {
  appSettingsStore.setRandomSystemMessagesEnabled(enabled);
  $q.notify({
    type: enabled ? 'positive' : 'info',
    message: enabled ? 'system messages enabled' : 'system messages disabled',
    position: 'bottom-right',
  });
}

// async function testSound() {
//   if (testingSound.value) return;
//   testingSound.value = true;
//   try {
//     // The click is a user gesture — unlock autoplay synchronously, then play.
//     unlockAudio();
//     await new Promise((resolve) => setTimeout(resolve, 60));
//     await playNotificationSound();
//     $q.notify({
//       type: 'info',
//       message: 'notification sound played — can you hear it?',
//       position: 'bottom-right',
//     });
//   } finally {
//     testingSound.value = false;
//   }
// }

async function handleStayMinimizedToggle(enabled: boolean) {
  // Persist the local preference immediately, then mirror it into Rust so the
  // native close handler knows whether to hide the window to the tray.
  appSettingsStore.setStayMinimized(enabled);

  try {
    await tauriInvoke('set_stay_minimized', { enabled });
  } catch (err) {
    console.warn('[AppTab] Failed to sync stay-minimized to native:', err);
  }

  $q.notify({
    type: enabled ? 'positive' : 'info',
    message: enabled
      ? 'closing the window will keep mourn in the tray'
      : 'mourn will close when the window is closed',
    position: 'bottom-right',
  });
}

async function handleReconnectDiscordRpc() {
  if (reconnectingDiscordRpc.value) {
    return;
  }

  reconnectingDiscordRpc.value = true;
  appSettingsStore.setDiscordRpcStatus('connecting', 'reconnecting to discord...');

  try {
    const result = await reconnectDiscordRpc();

    if (result.ok) {
      appSettingsStore.setDiscordRpcEnabled(true);
      appSettingsStore.setDiscordRpcStatus('connected', result.message);
      $q.notify({
        type: 'positive',
        message: 'rpc connected',
        position: 'bottom-right',
      });
      return;
    }

    appSettingsStore.setDiscordRpcStatus('failed', result.message);
    $q.notify({
      type: 'negative',
      message: result.message || 'failed to connect',
      position: 'bottom-right',
    });
  } finally {
    reconnectingDiscordRpc.value = false;
  }
}
</script>

<style scoped>
.dash-back-inline {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.app-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01));
}

.app-rpc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 14px 16px;
  border: 1px solid var(--dash-border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.28);
}

.app-rpc-copy {
  min-width: 0;
}

.app-rpc-label {
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: lowercase;
}

.app-rpc-desc {
  margin-top: 0.25rem;
  color: var(--dash-muted);
  font-size: 0.75rem;
  line-height: 1.45;
}

.app-rpc-status-wrap {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.app-rpc-reconnect {
  justify-self: start;
  color: var(--primary);
}

/* Underlying IPC failure reason (e.g. "discord rpc connect failed: …"). */
.app-rpc-reason {
  margin-top: 0.5rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--primary);
  border-radius: 0;
  background: rgba(255, 0, 0, 0.08);
  color: var(--primary);
  font-family: 'Courier New', monospace;
  font-size: 0.68rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.app-rpc-status {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--dash-muted);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: lowercase;
}

.app-rpc-status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  flex: 0 0 auto;
}

.app-rpc-status--connected {
  color: #4caf50;
}

.app-rpc-status--failed {
  color: #ffd54f;
}

.app-rpc-status--disabled {
  color: #e53935;
}

.app-rpc-status-dot--connected {
  background: #4caf50;
}

.app-rpc-status-dot--failed {
  background: #ffd54f;
}

.app-rpc-status-dot--disabled {
  background: #e53935;
}

@media (max-width: 640px) {
  .app-rpc-row {
    align-items: flex-start;
  }
}
</style>

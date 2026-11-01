<template>
  <div v-if="skipServerRender"></div>

  <template v-else>
    <TauriTitleBar />
    <DeviceLoginDialog />
    <BackdropLayer />
    <router-view />
  </template>
</template>

<script setup lang="ts">
import { computed, watch, onMounted, onUnmounted } from 'vue';
import { useTitleGlitch } from 'src/composables/useTitleGlitch';
import { useNativeShell } from 'src/composables/useNativeShell';
import { useDesktopNotifications } from 'src/composables/useDesktopNotifications';
import { useHealthMonitor } from 'src/composables/useHealthMonitor';
import { useAnnouncementsStore } from 'src/stores/announcements';
import { useAuthStore } from 'src/stores/auth';
import { useAppSettingsStore } from 'src/stores/appSettings';
import { useDevicePreferencesStore } from 'src/stores/devicePreferences';
import { useVaultStore } from 'src/stores/vault';
import { useDiscordRpc } from 'src/composables/useDiscordRpc';
import { isNativeBuild } from 'src/utils/platform';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import TauriTitleBar from 'src/components/TauriTitleBar.vue';
import DeviceLoginDialog from 'src/components/DeviceLoginDialog.vue';
import BackdropLayer from 'src/components/theme/BackdropLayer.vue';
import { installInterfaceHoverSounds } from 'src/utils/interfaceSounds';

const $q = useQuasar();
const router = useRouter();
const route = useRoute();
const isDesktopBuild = __MOURN_DESKTOP_BUILD__;
// Vault bootstrap and window-focus tracking apply to BOTH native shells
// (Tauri desktop + Capacitor mobile). Everything Tauri-specific below
// (Discord RPC, tray, stay-minimized) stays on isDesktopBuild.
const isNativeShellBuild = isNativeBuild;
useDesktopNotifications();
const devicePreferencesStore = useDevicePreferencesStore();
const appSettingsStore = useAppSettingsStore();
const { syncDiscordRpc } = useDiscordRpc();

/* ----------------------------------------------------------------
   SSR Guard — Prevents server crashes on "Dangerous" routes
   ---------------------------------------------------------------- */
interface SSRContext {
  req?: {
    __skipSsr?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const skipServerRender = computed(() => {
  // Returns true only when running on the Node server for a flagged route
  return (
    import.meta.env.QUASAR_SERVER && ($q as { ssrContext?: SSRContext }).ssrContext?.req?.__skipSsr === true
  );
});

/* ----------------------------------------------------------------
   Tauri Native Shell — desktop-only features
   ---------------------------------------------------------------- */
useNativeShell();

/* ----------------------------------------------------------------
   Health Monitoring — passive offline indicator only.
   Do not navigate on outages: route remounts restart API/SSE flows and can
   create request storms while the backend/network is recovering.
   ---------------------------------------------------------------- */
const { startMonitoring, stopMonitoring } = useHealthMonitor();

/* ----------------------------------------------------------------
   Tab Title Glitch
   ---------------------------------------------------------------- */
const isProfileRoute = computed(
  () => route.name === 'profile' || route.matched.some((record) => record.path === '/:username'),
);

const { start: startGlobalGlitch, stop: stopGlobalGlitch } = useTitleGlitch({
  title: '@ mourn',
  delay: 120,
  immediate: false,
});

let syncVaultFocusState: (() => void) | null = null;
let trayNavigateUnlisten: (() => void) | null = null;
let stopInterfaceHoverSounds: (() => void) | null = null;
const handleNotificationClick = (event: Event) => {
  const linkId = (event as CustomEvent<{ linkId: string }>).detail?.linkId;
  if (!linkId) return;
  void router.push({ name: 'messaging', params: { linkId } });
};

// Watcher only runs on CLIENT to avoid server errors
const shouldRunGlobalGlitch = computed(
  () => import.meta.env.QUASAR_CLIENT && !isProfileRoute.value && !devicePreferencesStore.performanceMode,
);

watch(
  shouldRunGlobalGlitch,
  (enabled) => {
    if (enabled) startGlobalGlitch();
    else stopGlobalGlitch();
  },
  { immediate: true, flush: 'sync' },
);

/* ----------------------------------------------------------------
   Real-time Announcements
   ---------------------------------------------------------------- */
const announcementsStore = useAnnouncementsStore();
const authStore = useAuthStore();
const vaultStore = useVaultStore();
const bootstrappedUsers = new Set<string>();

watch(
  () => route.name,
  (routeName) => {
    if (!import.meta.env.QUASAR_CLIENT || !isNativeShellBuild) return;
    if (routeName !== 'messaging') {
      vaultStore.setActiveLink(null);
    }
  },
  { immediate: true },
);

watch(
  () => [authStore.isLoggedIn, authStore.user?.id] as const,
  async ([isLoggedIn, userId]) => {
    if (!import.meta.env.QUASAR_CLIENT || !isNativeShellBuild || !isLoggedIn || !userId) {
      return;
    }

    if (bootstrappedUsers.has(userId)) {
      return;
    }

    bootstrappedUsers.add(userId);

    try {
      const { useVaultStore } = await import('src/stores/vault');
      const vaultStore = useVaultStore();
      // Establish the vault silently. Batch-sync mode suppresses per-message
      // chimes during the initial pull and plays ONE sound only if >3 new
      // (unread) messages arrive — the desired first-open behavior.
      await vaultStore.beginBatchSync(() => vaultStore.initialize());
    } catch (err) {
      console.error('[App] Failed to initialize vault:', err);
    }

    try {
      const { useLinksStore } = await import('src/stores/links');
      await useLinksStore().fetchLinks();
    } catch (err) {
      console.error('[App] Failed to fetch links:', err);
    }
  },
  { immediate: true },
);

onMounted(async () => {
  if (import.meta.env.QUASAR_CLIENT) {
    devicePreferencesStore.hydrate();
    appSettingsStore.hydrate();

    stopInterfaceHoverSounds = installInterfaceHoverSounds();
  }

  // Start health monitoring
  if (import.meta.env.QUASAR_CLIENT) {
    startMonitoring();
  }

  if (import.meta.env.QUASAR_CLIENT && isDesktopBuild && appSettingsStore.discordRpcEnabled) {
    try {
      appSettingsStore.setDiscordRpcStatus('connecting', 'connecting to discord...');
      const result = await syncDiscordRpc(true);
      if (!result.ok) {
        console.warn('[App] Failed to start Discord RPC on startup:', result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to connect';
      appSettingsStore.setDiscordRpcStatus('failed', message);
      console.warn('[App] Failed to start Discord RPC on startup:', error);
    }
  }

  if (isNativeShellBuild) {
    syncVaultFocusState = () => {
      vaultStore.setAppFocused(document.visibilityState !== 'hidden' && document.hasFocus());
    };
    syncVaultFocusState();
    window.addEventListener('focus', syncVaultFocusState);
    window.addEventListener('blur', syncVaultFocusState);
    document.addEventListener('visibilitychange', syncVaultFocusState);
  }

  // Reconcile desktop app-lifecycle prefs with the native side on launch.
  // The value in the store comes from appSettingsStore.hydrate() (localStorage)
  // which runs at module scope above. We mirror `stayMinimized` into Rust so
  // the close handler knows the right behavior immediately.
  // NOTE: "open on startup" (OS autostart) was removed from the app.
  if (import.meta.env.QUASAR_CLIENT && isDesktopBuild) {
    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);

    trayNavigateUnlisten = await listen<string>('tray-navigate', (event) => {
      void router.push(event.payload);
    });

    try {
      await invoke('set_stay_minimized', { enabled: appSettingsStore.stayMinimized });
    } catch (err) {
      console.warn('[App] Failed to sync stay-minimized on startup:', err);
    }
  }

  // Only init SSE in the browser
  if (import.meta.env.QUASAR_CLIENT) {
    void announcementsStore.init();
  }

  // Listen for notification clicks to navigate to the chat.
  window.addEventListener('mourn:notification-click', handleNotificationClick);
});

onUnmounted(() => {
  window.removeEventListener('mourn:notification-click', handleNotificationClick);
  stopInterfaceHoverSounds?.();
  stopInterfaceHoverSounds = null;

  if (trayNavigateUnlisten) {
    trayNavigateUnlisten();
    trayNavigateUnlisten = null;
  }

  if (syncVaultFocusState) {
    window.removeEventListener('focus', syncVaultFocusState);
    window.removeEventListener('blur', syncVaultFocusState);
    document.removeEventListener('visibilitychange', syncVaultFocusState);
    syncVaultFocusState = null;
  }

  if (import.meta.env.QUASAR_CLIENT) {
    announcementsStore.destroy();
    stopMonitoring();
  }
});
</script>

<style>
/*
 * Tauri title bar offset.
 * We cannot use margin-top because Quasar's fixed footer anchors to
 * the viewport bottom and would get cut off. Instead we make the
 * #q-app a flex column and let the title bar (32px fixed) simply
 * push everything else down via a top padding on the layout.
 *
 * The key insight: Quasar's q-footer is inside .q-layout, so if we
 * shrink the layout itself the footer stays inside it.
 */
body.is-tauri #q-app {
  display: flex;
  flex-direction: column;
  height: 100vh !important;
  overflow: hidden !important;
}
body.is-tauri .q-layout {
  flex: 1;
  height: auto !important;
  min-height: 0;
}
/* Remove offset in fullscreen — title bar slides away */
body.is-tauri.is-tauri-fullscreen .q-layout {
  height: 100vh !important;
}
</style>

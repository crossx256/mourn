<template>
  <canvas id="m-backdrop" ref="canvas" aria-hidden="true"></canvas>
  <p v-if="autoDisabled && !policySuspended" class="backdrop-status" role="status">
    Effects paused: frame budget exceeded.
  </p>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDevicePreferencesStore } from 'src/stores/devicePreferences';
import { THEME_ENABLED, useThemeStore } from 'src/stores/theme';
import { BackdropEngine } from 'src/theme/backdrop/engine';
import { applyFrosted, resolveTheme } from 'src/theme/apply';

const AUTH_PATHS = new Set([
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/register',
  '/register/invite',
]);
const canvas = ref<HTMLCanvasElement | null>(null);
const autoDisabled = ref(false);
const policySuspended = ref(true);
let configuration = '';
const setBackdropActive = (active: boolean) => {
  document.documentElement.toggleAttribute('data-backdrop-active', active);
};
const route = useRoute();
const theme = useThemeStore();
const device = useDevicePreferencesStore();
let engine: BackdropEngine | null = null;
let stopWatch: (() => void) | null = null;

onMounted(() => {
  if (!canvas.value) return;
  engine = new BackdropEngine(
    canvas.value,
    {
      now: () => performance.now(),
      requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
      cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
      window,
      document,
      mobile: __MOURN_MOBILE_BUILD__,
    },
    {
      onAutoDisable: () => {
        autoDisabled.value = true;
        setBackdropActive(false);
      },
    },
  );
  stopWatch = watch(
    () =>
      [
        { ...theme.prefs.fx, color: theme.prefs.fx.color ?? resolveTheme(theme.prefs).accent },
        theme.suspended,
        theme.prefs.extras.reduceMotion,
        device.performanceMode,
        route.name,
        route.path,
        theme.prefs.frosted,
      ] as const,
    ([fx, storeSuspended, reduceMotion, performanceMode]) => {
      const nextConfiguration = JSON.stringify(fx);
      if (configuration !== nextConfiguration) {
        configuration = nextConfiguration;
        autoDisabled.value = false;
      }
      const routeSuspended =
        route.name === 'profile' ||
        [...AUTH_PATHS].some((path) => route.path === path || route.path.startsWith(`${path}/`));
      policySuspended.value =
        !THEME_ENABLED || storeSuspended || reduceMotion || performanceMode || routeSuspended;
      applyFrosted(THEME_ENABLED && !storeSuspended && !routeSuspended && theme.prefs.frosted);
      engine?.setSuspended(policySuspended.value);
      engine?.configure(fx);
      engine?.start();
      setBackdropActive(!policySuspended.value && !autoDisabled.value && fx.pattern !== 'none');
    },
    { immediate: true, deep: true },
  );
});

onBeforeUnmount(() => {
  stopWatch?.();
  stopWatch = null;
  engine?.destroy();
  engine = null;
  setBackdropActive(false);
  applyFrosted(false);
});
</script>

<style scoped>
#m-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.backdrop-status {
  position: fixed;
  bottom: 48px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6000;
  margin: 0;
  max-width: calc(100vw - 24px);
  padding: 6px 10px;
  color: rgb(var(--m-text-rgb));
  background: rgb(var(--m-surface-rgb));
  border: 1px solid rgb(var(--m-borderStrong-rgb));
  font-size: 12px;
  white-space: nowrap;
}
</style>

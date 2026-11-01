// =============================================
// usePlatform — Centralized environment detection
// =============================================
// Provides reactive booleans for platform-aware UI branching:
//   • isTauri       — Running inside the Tauri desktop shell
//   • isCapacitor   — Running inside the Capacitor mobile shell
//   • isNativeShell — Running inside ANY native shell (Tauri or Capacitor)
//   • isDesktop     — Screen width ≥ md breakpoint (1024px)
//   • isMobile      — Screen width < md breakpoint
//
// SECURITY: Messages & Notification icons must NEVER render
// on the standard web version. Gate them with `isNativeShell`
// (both native shells) — never with a build flag alone.

import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useNativeShell } from './useNativeShell';

export function usePlatform() {
  const $q = useQuasar();
  const { isTauri, isCapacitor, isNativeShell } = useNativeShell();
  const viewportWidth = ref(1024);
  const viewportHydrated = ref(false);
  let stopViewportSync: (() => void) | null = null;

  onMounted(() => {
    const syncViewportWidth = () => {
      viewportWidth.value = window.innerWidth;
    };

    syncViewportWidth();
    viewportHydrated.value = true;
    window.addEventListener('resize', syncViewportWidth, { passive: true });
    stopViewportSync = () => {
      window.removeEventListener('resize', syncViewportWidth);
    };
  });

  onUnmounted(() => {
    stopViewportSync?.();
    stopViewportSync = null;
  });

  const resolvedWidth = computed(() => {
    if (!viewportHydrated.value) return 1024;

    const screenWidth = $q?.screen?.width;
    if (typeof screenWidth === 'number' && screenWidth > 0) {
      return screenWidth;
    }

    return viewportWidth.value;
  });

  /** True when viewport is ≥ md (1024px) — desktop layout */
  const isDesktop = computed(() => {
    return resolvedWidth.value >= 1024;
  });

  /** True when viewport is < md — mobile layout */
  const isMobile = computed(() => {
    return resolvedWidth.value < 1024;
  });

  return {
    isTauri,
    isCapacitor,
    isNativeShell,
    isDesktop,
    isMobile,
    viewportWidth: resolvedWidth,
  };
}

import { defineBoot } from '#q-app';
import { watch } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { useDevicePreferencesStore } from 'src/stores/devicePreferences';
import { THEME_ENABLED, useThemeStore } from 'src/stores/theme';
export default defineBoot(({ router }) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('mourn_theme_enabled', String(THEME_ENABLED));
  } catch {
    /* optional cache */
  }
  if (!THEME_ENABLED) return;
  const theme = useThemeStore(),
    auth = useAuthStore(),
    device = useDevicePreferencesStore();
  device.hydrate();
  watch(
    () =>
      [router.currentRoute.value, device.performanceMode, theme.prefs.extras.reduceMotion] as const,
    ([route]) => {
      theme.suspended =
        route.name === 'profile' ||
        /^\/(login|forgot-password|reset-password|verify-email|register)(\/|$)/.test(route.path);
      theme.render();
    },
    { immediate: true },
  );
  watch(
    () => auth.user?.id,
    (id) => {
      void theme.setAccount(id == null ? '' : String(id));
    },
    { immediate: true },
  );
  window.addEventListener('online', () => {
    if (theme.pending) void theme.sync();
  });
});

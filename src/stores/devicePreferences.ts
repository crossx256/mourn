import { defineStore } from 'pinia';

const PERFORMANCE_MODE_KEY = 'mourn_device_performance_mode';

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

function syncPerformanceBodyClass(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('performance-mode', enabled);
}

export const useDevicePreferencesStore = defineStore('devicePreferences', {
  state: () => ({
    performanceMode: false,
    themeReduceMotion: false,
    hydrated: false,
  }),

  actions: {
    syncPerformanceMode() {
      syncPerformanceBodyClass(this.performanceMode || this.themeReduceMotion);
    },

    setThemeReduceMotion(enabled: boolean) {
      this.themeReduceMotion = enabled;
      this.syncPerformanceMode();
    },

    hydrate() {
      if (this.hydrated) return;
      this.performanceMode = readStoredBoolean(PERFORMANCE_MODE_KEY, false);
      this.hydrated = true;
      this.syncPerformanceMode();
    },

    setPerformanceMode(enabled: boolean) {
      this.performanceMode = enabled;
      this.hydrated = true;
      writeStoredBoolean(PERFORMANCE_MODE_KEY, enabled);
      this.syncPerformanceMode();
    },

    togglePerformanceMode() {
      this.setPerformanceMode(!this.performanceMode);
    },
  },
});

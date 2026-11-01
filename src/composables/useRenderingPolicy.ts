import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useDevicePreferencesStore } from '../stores/devicePreferences';

/** Decorative rendering only: never suspend networking or application state. */
export function useRenderingPolicy() {
  const preferences = useDevicePreferencesStore();
  const visible = ref(false);
  const reducedMotion = ref(false);
  let media: MediaQueryList | undefined;
  const sync = () => {
    visible.value = document.visibilityState !== 'hidden';
    reducedMotion.value = media?.matches ?? false;
  };
  onMounted(() => {
    media = window.matchMedia('(prefers-reduced-motion: reduce)');
    sync();
    media.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
  });
  onUnmounted(() => {
    media?.removeEventListener('change', sync);
    document.removeEventListener('visibilitychange', sync);
  });
  const lowMotion = computed(() => reducedMotion.value || preferences.performanceMode);
  return { visible, lowMotion, animate: computed(() => visible.value && !lowMotion.value) };
}

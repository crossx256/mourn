import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import { useRenderingPolicy } from '../src/composables/useRenderingPolicy';
import { useDevicePreferencesStore } from '../src/stores/devicePreferences';

const hooks = vi.hoisted(() => ({
  mounted: [] as (() => void)[],
  unmounted: [] as (() => void)[],
}));
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onMounted: (fn: () => void) => hooks.mounted.push(fn),
  onUnmounted: (fn: () => void) => hooks.unmounted.push(fn),
}));
afterEach(() => {
  hooks.unmounted.forEach((fn) => fn());
  hooks.mounted.length = 0;
  hooks.unmounted.length = 0;
  vi.unstubAllGlobals();
});

it('responds to visibility, live reduced motion and device preference; removes listeners', () => {
  setActivePinia(createPinia());
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const media = Object.assign(new EventTarget(), { matches: false });
  const removeDocument = vi.spyOn(doc, 'removeEventListener');
  const removeMedia = vi.spyOn(media, 'removeEventListener');
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { matchMedia: () => media });
  const scope = effectScope();
  const policy = scope.run(useRenderingPolicy)!;
  expect(policy.animate.value).toBe(false);
  hooks.mounted.forEach((fn) => fn());
  expect(policy.animate.value).toBe(true);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(policy.animate.value).toBe(false);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(policy.animate.value).toBe(true);
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(policy.lowMotion.value).toBe(true);
  expect(policy.animate.value).toBe(false);
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  useDevicePreferencesStore().performanceMode = true;
  expect(policy.animate.value).toBe(false);
  hooks.unmounted.forEach((fn) => fn());
  hooks.unmounted.length = 0;
  expect(removeDocument).toHaveBeenCalledTimes(1);
  expect(removeMedia).toHaveBeenCalledTimes(1);
  scope.stop();
});

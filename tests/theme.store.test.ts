import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick, ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { defaults, type ThemePrefs } from '../src/theme/preferences';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  csrf: vi.fn(),
  apply: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('#q-app', () => ({ defineBoot: (callback: unknown) => callback }));
vi.mock('src/boot/axios', () => ({ api: { get: mocks.get, put: mocks.put } }));
vi.mock('../src/stores/auth', () => ({
  useAuthStore: () => ({ fetchCsrfToken: mocks.csrf, csrfToken: 'csrf' }),
}));
vi.mock('src/utils/platform', () => ({ isDesktopBuild: false }));
vi.mock('src/theme/apply', () => ({ applyTheme: mocks.apply, clearTheme: mocks.clear }));
vi.mock('src/theme/preferences', async () => await import('../src/theme/preferences'));
const memory = new Map<string, string>();
let scope: ReturnType<typeof effectScope>;
async function bootTheme(performanceMode = false) {
  const { useDevicePreferencesStore } = await import('../src/stores/devicePreferences');
  const { useThemeStore } = await import('../src/stores/theme');
  const { default: boot } = await import('../src/boot/theme');
  const device = useDevicePreferencesStore();
  device.setPerformanceMode(performanceMode);
  const currentRoute = ref({ name: 'dashboard' } as RouteLocationNormalizedLoaded);
  scope.run(() => boot({ router: { currentRoute } } as Parameters<typeof boot>[0]));
  await nextTick();
  return { device, theme: useThemeStore(), currentRoute };
}
const expectPerformance = (enabled: boolean) =>
  expect(document.body.classList.toggle).toHaveBeenLastCalledWith('performance-mode', enabled);
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('VITE_CLIENT_THEMES', 'true');
  memory.clear();
  setActivePinia(createPinia());
  scope = effectScope();
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
  });
  vi.stubGlobal('document', { body: { classList: { toggle: vi.fn() } } });
  mocks.get.mockResolvedValue({ data: { success: true, data: defaults() } });
  mocks.put.mockImplementation(async (_url: string, p: unknown) => ({
    data: { success: true, data: p },
  }));
});
afterEach(() => {
  scope.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('performance mode ownership', () => {
  it('keeps device performance mode when theme reduce motion is false', async () => {
    const { theme } = await bootTheme(true);
    theme.preview(defaults());
    expectPerformance(true);
  });
  it('reacts to device toggles after boot without erasing theme reduce motion', async () => {
    const { device, theme } = await bootTheme();
    expectPerformance(false);
    device.performanceMode = true;
    await nextTick();
    expectPerformance(true);
    device.performanceMode = false;
    await nextTick();
    expectPerformance(false);
    theme.preview({ ...defaults(), extras: { ...defaults().extras, reduceMotion: true } });
    expectPerformance(true);
    vi.mocked(document.body.classList.toggle).mockClear();
    device.setPerformanceMode(false);
    await nextTick();
    expectPerformance(true);
    expect(document.body.classList.toggle).not.toHaveBeenCalledWith('performance-mode', false);
  });
  it.each([
    '/login',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/register',
    '/register/invite/abc',
  ])('suspends only theme motion on auth route %s', async (path) => {
    const { device, theme, currentRoute } = await bootTheme();
    theme.preview({ ...defaults(), extras: { ...defaults().extras, reduceMotion: true } });
    currentRoute.value = { path } as RouteLocationNormalizedLoaded;
    await nextTick();
    expectPerformance(false);
    device.setPerformanceMode(true);
    await nextTick();
    expectPerformance(true);
    device.setPerformanceMode(false);
    await nextTick();
    expectPerformance(false);
    currentRoute.value = { path: '/dashboard' } as RouteLocationNormalizedLoaded;
    await nextTick();
    expectPerformance(true);
  });
  it.each([false, true])(
    'restores the current device preference, not boot snapshot %s',
    async (initial) => {
      const { device, theme, currentRoute } = await bootTheme(initial);
      theme.preview({ ...defaults(), extras: { ...defaults().extras, reduceMotion: true } });
      device.setPerformanceMode(!initial);
      currentRoute.value = { name: 'profile' } as RouteLocationNormalizedLoaded;
      await nextTick();
      expectPerformance(!initial);
      expect(mocks.clear).toHaveBeenCalled();
      device.setPerformanceMode(initial);
      await nextTick();
      expectPerformance(initial);
      currentRoute.value = { name: 'dashboard' } as RouteLocationNormalizedLoaded;
      await nextTick();
      expectPerformance(true);
    },
  );
});
describe('account appearance synchronization', () => {
  it.each(['top', 'saved'])(
    'rejects malformed %s presets without partially previewing',
    async (level) => {
      const { useThemeStore } = await import('../src/stores/theme');
      const s = useThemeStore();
      s.preview({ ...defaults(), preset: 'ice' });
      mocks.apply.mockClear();
      const revision = s.revision;
      const malformed =
        level === 'top'
          ? { ...defaults(), preset: ['crimson'], frosted: true }
          : {
              ...defaults(),
              frosted: true,
              saved: [{ id: 'saved', name: 'look', preset: ['crimson'], accent: null }],
            };
      s.preview(malformed as unknown as ThemePrefs);
      expect(s.prefs).toEqual({ ...defaults(), preset: 'ice' });
      expect(s.revision).toBe(revision);
      expect(mocks.apply).not.toHaveBeenCalled();
    },
  );
  it('hydrates old v1 cache blobs with new preference defaults', async () => {
    const {
      fx: _fx,
      frosted: _frosted,
      font: _font,
      ...legacy
    } = {
      ...defaults(),
      preset: 'ice' as const,
    };
    memory.set('mourn_theme_u1:a', JSON.stringify({ prefs: legacy, pending: false }));
    mocks.get.mockRejectedValue(new Error('offline'));
    const { useThemeStore } = await import('../src/stores/theme');
    const s = useThemeStore();
    await s.setAccount('a');
    expect(s.prefs).toMatchObject({
      preset: 'ice',
      fx: { pattern: 'none', color: null, intensity: 0.5, size: 1 },
      frosted: false,
      font: 'mono',
    });
  });
  it.each(['404', 'offline'])(
    'keeps cached preferences and saves locally on %s',
    async (failure) => {
      const cached = { ...defaults(), preset: 'ice' };
      memory.set('mourn_theme_u1:a', JSON.stringify({ prefs: cached, pending: false }));
      mocks.get.mockRejectedValue(new Error(failure));
      mocks.put.mockRejectedValue(new Error(failure));
      const { useThemeStore } = await import('../src/stores/theme');
      const s = useThemeStore();
      await s.setAccount('a');
      expect(s.prefs.preset).toBe('ice');
      await settle();
      expect(s.error).toContain('Account theme unavailable');
      s.preview({ ...defaults(), preset: 'violet' });
      await s.save();
      expect(s.committed.preset).toBe('violet');
      expect(s.dirty).toBe(false);
      await settle();
      expect(s.pending).toBe(true);
      expect(JSON.parse(memory.get('mourn_theme_u1:a')!).prefs.preset).toBe('violet');
      s.preview(defaults());
      s.cancel();
      expect(s.prefs.preset).toBe('violet');
      s.preview({ ...defaults(), preset: 'ice' });
      mocks.put.mockImplementation(async (_url: string, p: unknown) => ({
        data: { success: true, data: p },
      }));
      await s.sync();
      expect(s.pending).toBe(false);
      expect(s.prefs.preset).toBe('ice');
      expect(s.committed.preset).toBe('violet');
      expect(s.dirty).toBe(true);
      expect(mocks.put.mock.lastCall![1].preset).toBe('violet');
    },
  );
  it.each(['GET', 'PUT', 'CSRF'])(
    'never waits for hanging %s and bounds background work',
    async (stage) => {
      vi.useFakeTimers();
      const hang = () => new Promise<never>(() => {});
      if (stage === 'GET') mocks.get.mockImplementation(hang);
      if (stage === 'PUT') mocks.put.mockImplementation(hang);
      if (stage === 'CSRF') mocks.csrf.mockImplementation(hang);
      const { useThemeStore } = await import('../src/stores/theme');
      const s = useThemeStore();
      await s.setAccount('a');
      s.preview({ ...defaults(), preset: 'ice' });
      await s.save();
      expect(s.committed.preset).toBe('ice');
      expect(s.dirty).toBe(false);
      await settle();
      await vi.advanceTimersByTimeAsync(5000);
      expect(s.loading).toBe(false);
      expect(s.saving).toBe(false);
      expect(s.pending).toBe(stage !== 'GET');
      if (stage === 'CSRF') expect(mocks.put).not.toHaveBeenCalled();
    },
  );
  it('coalesces rapid explicit saves and ignores old GET and PUT results', async () => {
    let get!: (x: unknown) => void;
    let put!: (x: unknown) => void;
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          get = resolve;
        }),
    );
    mocks.put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          put = resolve;
        }),
    );
    const { useThemeStore } = await import('../src/stores/theme');
    const s = useThemeStore();
    await s.setAccount('a');
    s.preview({ ...defaults(), preset: 'ice' });
    await s.save();
    await settle();
    s.preview({ ...defaults(), preset: 'violet' });
    await s.save();
    expect(s.committed.preset).toBe('violet');
    expect(JSON.parse(memory.get('mourn_theme_u1:a')!).prefs.preset).toBe('violet');
    get({ data: { success: true, data: defaults() } });
    put({ data: { success: true, data: { ...defaults(), preset: 'ice' } } });
    await settle();
    expect(s.prefs.preset).toBe('violet');
    expect(s.committed.preset).toBe('violet');
    expect(mocks.put).toHaveBeenCalledTimes(2);
    expect(mocks.put.mock.calls[1]![1].preset).toBe('violet');
    expect(s.pending).toBe(false);
  });
  it('isolates guest and account caches and ignores late PUT after account switches', async () => {
    let finish!: (x: unknown) => void;
    const { useThemeStore } = await import('../src/stores/theme');
    const s = useThemeStore();
    await s.setAccount('');
    s.preview({ ...defaults(), preset: 'ice' });
    await s.save();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(s.pending).toBe(false);
    await s.setAccount('a');
    await settle();
    expect(s.prefs.preset).toBe('crimson');
    mocks.put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    s.preview({ ...defaults(), preset: 'violet' });
    await s.save();
    await settle();
    await s.setAccount('b');
    await settle();
    finish({ data: { success: true, data: defaults() } });
    await settle();
    expect(s.userId).toBe('b');
    expect(s.prefs.preset).toBe('crimson');
    expect(JSON.parse(memory.get('mourn_theme_u1:a')!).pending).toBe(true);
    await s.setAccount('');
    expect(s.prefs.preset).toBe('ice');
    expect(memory.has('mourn_theme_u1:a')).toBe(true);
    await s.setAccount('a');
    expect(s.prefs.preset).toBe('violet');
    await settle();
    expect(s.pending).toBe(false);
  });
  it('previews without persistence and commits only on explicit save', async () => {
    const { useThemeStore } = await import('../src/stores/theme');
    const s = useThemeStore();
    await s.setAccount('a');
    await settle();
    memory.clear();
    s.preview({ ...defaults(), preset: 'ice' });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(memory.size).toBe(0);
    expect(s.dirty).toBe(true);
    await s.save();
    await settle();
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(s.dirty).toBe(false);
    expect(s.pending).toBe(false);
  });
  it('ignores late responses for previous accounts', async () => {
    let finish!: (x: unknown) => void;
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { useThemeStore } = await import('../src/stores/theme');
    const s = useThemeStore();
    const first = s.setAccount('a');
    await s.setAccount('b');
    finish({ data: { success: true, data: { ...defaults(), preset: 'phosphor' } } });
    await first;
    await settle();
    expect(s.userId).toBe('b');
    expect(s.prefs.preset).toBe('crimson');
    expect(memory.has('mourn_theme_u1:a')).toBe(false);
  });
  it('does not overwrite edits made during GET or PUT', async () => {
    let finish!: (x: unknown) => void;
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { useThemeStore } = await import('../src/stores/theme');
    const s = useThemeStore();
    const load = s.setAccount('a');
    s.preview({ ...defaults(), preset: 'ice' });
    finish({ data: { success: true, data: defaults() } });
    await load;
    await settle();
    expect(s.prefs.preset).toBe('ice');
    mocks.put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const save = s.save();
    await Promise.resolve();
    await Promise.resolve();
    s.preview({ ...s.prefs, preset: 'violet' });
    finish({ data: { success: true, data: { ...defaults(), preset: 'ice' } } });
    await save;
    await settle();
    expect(s.prefs.preset).toBe('violet');
    expect(s.committed.preset).toBe('ice');
    expect(s.dirty).toBe(true);
  });
  it('retains failed explicit saves and retries on next launch', async () => {
    const { useThemeStore } = await import('../src/stores/theme');
    const s = useThemeStore();
    await s.setAccount('a');
    s.preview({ ...defaults(), preset: 'ice' });
    mocks.put.mockRejectedValueOnce(new Error('offline'));
    await s.save();
    await settle();
    expect(s.pending).toBe(true);
    setActivePinia(createPinia());
    const next = useThemeStore();
    await next.setAccount('a');
    await settle();
    expect(next.prefs.preset).toBe('ice');
    expect(next.pending).toBe(false);
  });
});

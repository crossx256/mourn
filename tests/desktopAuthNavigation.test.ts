import { afterEach, expect, it, vi } from 'vitest';
import createAppRouter from '../src/router';

const { auth } = vi.hoisted(() => ({ auth: { isLoggedIn: false, autoLogin: vi.fn(), checkSession: vi.fn() } }));
vi.mock('src/stores/auth', () => ({ useAuthStore: () => auth }));
vi.mock('src/utils/platform', () => ({ isNativeShellActive: () => true, isTauriRuntime: () => true }));
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return { ...actual, createWebHashHistory: actual.createMemoryHistory, createWebHistory: actual.createMemoryHistory };
});
vi.mock('../src/router/routes', () => ({ default: [
  { path: '/login', component: {} },
  { path: '/dashboard', component: {}, meta: { requiresAuth: true } },
  { path: '/', component: {} },
] }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('returns to the protected dashboard after desktop restore outlives the startup budget', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  auth.isLoggedIn = false;
  let restore!: () => void;
  auth.autoLogin.mockReturnValue(new Promise<boolean>((resolve) => {
    restore = () => { auth.isLoggedIn = true; resolve(true); };
  }));
  auth.checkSession.mockResolvedValue(false);
  const router = await createAppRouter({} as Parameters<typeof createAppRouter>[0]);
  const navigation = router.push('/dashboard?tab=security');
  await vi.advanceTimersByTimeAsync(1500);
  await navigation;
  expect(router.currentRoute.value.path).toBe('/login');
  restore();
  await vi.advanceTimersByTimeAsync(0);
  expect(router.currentRoute.value.fullPath).toBe('/dashboard?tab=security');
});

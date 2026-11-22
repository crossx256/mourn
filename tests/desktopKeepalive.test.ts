import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axiosBoot, { api } from 'boot/axios';
import keepaliveBoot from 'boot/desktopSessionKeepalive';

const { auth } = vi.hoisted(() => ({
  auth: { isLoggedIn: true, user: { id: 'alice' }, authOperationGeneration: 1, clearMobileAuthState: vi.fn() },
}));
vi.mock('src/stores/auth', () => ({ useAuthStore: () => auth }));
vi.mock('src/utils/platform', () => ({ isNativeShellActive: () => true, isTauriRuntime: () => true, isMobileBuild: false, isNativeBuild: true }));
vi.mock('src/services/mobileAuth', () => ({ isMobileAuthRuntime: () => false }));

const adapter = api.defaults.adapter;
const router = { push: vi.fn(), currentRoute: { value: { fullPath: '/dashboard', meta: { requiresAuth: true } } } };
const unauthorized = (config: InternalAxiosRequestConfig) => new AxiosError('Session expired', undefined, config, undefined, {
  status: 401, data: { code: 'AUTH_REQUIRED' }, config,
} as AxiosResponse);

type BootContext = Parameters<typeof keepaliveBoot>[0];
const context = { router } as unknown as BootContext;

beforeEach(() => {
  vi.useFakeTimers();
  auth.authOperationGeneration = 1;
  router.push.mockReset();
  auth.clearMobileAuthState.mockReset();
  void axiosBoot(context);
  void keepaliveBoot(context);
});

afterEach(() => {
  api.interceptors.response.clear();
  api.defaults.adapter = adapter;
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('does not redirect or invalidate the replacement session on a late heartbeat 401', async () => {
  let rejectHeartbeat!: () => void;
  api.defaults.adapter = (config) => new Promise((_resolve, reject) => {
    rejectHeartbeat = () => reject(unauthorized(config));
  });
  await vi.advanceTimersByTimeAsync(300_000);
  auth.authOperationGeneration++;
  rejectHeartbeat();
  await vi.advanceTimersByTimeAsync(0);
  expect(router.push).not.toHaveBeenCalled();
  expect(auth.clearMobileAuthState).not.toHaveBeenCalled();
});

it('clears the current desktop session on an authoritative heartbeat failure', async () => {
  api.defaults.adapter = async (config) => { throw unauthorized(config); };
  await vi.advanceTimersByTimeAsync(300_000);
  expect(auth.clearMobileAuthState).toHaveBeenCalledOnce();
  expect(router.push).toHaveBeenCalledOnce();
});

it('keeps the session on a transient heartbeat failure', async () => {
  api.defaults.adapter = async () => { throw new AxiosError('Network Error'); };
  await vi.advanceTimersByTimeAsync(300_000);
  expect(auth.clearMobileAuthState).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

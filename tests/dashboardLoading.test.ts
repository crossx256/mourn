import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardStore } from 'src/stores/dashboard';

const { get, auth } = vi.hoisted(() => ({
  get: vi.fn(),
  auth: { isLoggedIn: true, user: { id: 'alice' }, authOperationGeneration: 0, fetchCsrfToken: vi.fn() },
}));
vi.mock('boot/axios', () => ({ api: { get } }));
vi.mock('src/stores/auth', () => ({ useAuthStore: () => auth }));
vi.mock('quasar', () => ({ Notify: { create: vi.fn() } }));

const dashboardResponse = (id: string) => ({
  data: { success: true, data: { user: { id, username: id }, profile: { userId: id } } },
});

beforeEach(() => {
  setActivePinia(createPinia());
  auth.user = { id: 'alice' };
  auth.authOperationGeneration = 0;
  get.mockReset();
  auth.fetchCsrfToken.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('dashboard profile loading', () => {
  it('loads an authenticated GET without waiting on a stalled CSRF fetch', async () => {
    auth.fetchCsrfToken.mockReturnValue(new Promise(() => {}));
    get.mockResolvedValue(dashboardResponse('alice'));
    const dashboard = useDashboardStore();
    void dashboard.fetchDashboardData();
    await Promise.resolve();
    await Promise.resolve();
    expect(get).toHaveBeenCalledWith('/api/v1/profile/dashboard', expect.anything());
    await vi.waitFor(() => expect(dashboard.username).toBe('alice'));
    expect(dashboard.isLoading).toBe(false);
  });

  it('times out a never-settling GET and permits a retry', async () => {
    vi.useFakeTimers();
    get.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(dashboardResponse('alice'));
    const dashboard = useDashboardStore();
    const load = dashboard.fetchDashboardData();
    expect(dashboard.isLoading).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(dashboard.isLoading).toBe(false);
    await expect(load).resolves.toBe(false);
    expect(dashboard.error).toBeTruthy();
    expect(get.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    await expect(dashboard.fetchDashboardData()).resolves.toBe(true);
    expect(dashboard.username).toBe('alice');
  });

  it('discards a previous account response without clobbering a newer load', async () => {
    let finish!: (value: unknown) => void;
    get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    get.mockResolvedValueOnce(dashboardResponse('bob'));
    const dashboard = useDashboardStore();
    const old = dashboard.fetchDashboardData();
    await Promise.resolve();
    auth.user = { id: 'bob' };
    auth.authOperationGeneration++;
    dashboard.$reset();
    await expect(dashboard.fetchDashboardData()).resolves.toBe(true);
    finish(dashboardResponse('alice'));
    await expect(old).resolves.toBe(false);
    expect(dashboard.username).toBe('bob');
  });
});

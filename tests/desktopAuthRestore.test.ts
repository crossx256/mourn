import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from 'src/stores/auth';

const { get, listCredentials, getCredentials, saveCredentials } = vi.hoisted(() => ({
  get: vi.fn(), listCredentials: vi.fn(), getCredentials: vi.fn(), saveCredentials: vi.fn(),
}));
vi.mock('boot/axios', () => ({ api: { get }, mobilePreAuthApi: {}, refreshMobileSession: vi.fn() }));
vi.mock('src/composables/useSecureStore', () => ({
  useSecureStore: () => ({ getCredentials, listCredentials, saveCredentials }),
}));
vi.mock('src/utils/platform', () => ({ isNativeShellActive: () => true }));
vi.mock('src/services/mobileAuth', () => ({ isMobileAuthRuntime: () => false }));
vi.mock('src/services/clientFingerprint', () => ({ collectClientFingerprint: async () => null, hashClientFingerprint: async () => null }));
vi.mock('src/stores/vault', () => ({ useVaultStore: () => ({ initialize: async () => {} }) }));
vi.mock('src/stores/accounts', () => ({ useAccountsStore: () => ({ saveAccount: async () => {} }) }));
vi.mock('src/utils/accountLifecycle', async (importOriginal) => ({
  ...await importOriginal<object>(), teardownPrivateStores: async () => ({ success: true }),
}));
vi.mock('quasar', () => ({ Notify: { create: vi.fn() } }));

const credentials = { username: 'saved-user', password: 'fixture-only', stayLoggedIn: true };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('localStorage', { setItem: vi.fn(), removeItem: vi.fn() });
  setActivePinia(createPinia());
  listCredentials.mockResolvedValue([credentials]);
  getCredentials.mockResolvedValue(credentials);
});

describe('desktop saved-session recovery', () => {
  it('does not let an anonymous session probe invalidate an in-flight saved login', async () => {
    const auth = useAuthStore();
    let resolveLogin!: (response: unknown) => void;
    vi.spyOn(auth, 'postWithFreshCsrf').mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
    const restore = auth.autoLogin();
    await vi.waitFor(() => expect(auth.postWithFreshCsrf).toHaveBeenCalledOnce());
    get.mockRejectedValueOnce({ response: { status: 401, data: { code: 'AUTH_REQUIRED' } } });
    await expect(auth.checkSession()).resolves.toBe(false);
    resolveLogin({ headers: { 'content-type': 'application/json' }, data: { success: true, data: { user: { id: 'saved-id', username: credentials.username } } } });
    await expect(restore).resolves.toBe(true);
    expect(auth.user?.id).toBe('saved-id');
  });

  it('does not let a slow credential lookup start a login after another auth operation', async () => {
    const auth = useAuthStore();
    let resolveList!: (value: unknown) => void;
    listCredentials.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    const login = vi.spyOn(auth, 'login').mockResolvedValue({ success: true });
    const restore = auth.autoLogin();
    auth.clearMobileAuthState();
    resolveList([credentials]);
    await expect(restore).resolves.toBe(false);
    expect(login).not.toHaveBeenCalled();
  });
});

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from 'src/stores/auth';

const { get, listCredentials, getCredentials, saveCredentials, isMobile, vault } = vi.hoisted(() => ({
  get: vi.fn(), listCredentials: vi.fn(), getCredentials: vi.fn(), saveCredentials: vi.fn(),
  isMobile: vi.fn(), vault: { isInitialized: true, initialize: vi.fn(), clearVaultState: vi.fn() },
}));
vi.mock('boot/axios', () => ({ api: { get }, mobilePreAuthApi: {}, refreshMobileSession: vi.fn() }));
vi.mock('src/composables/useSecureStore', () => ({
  useSecureStore: () => ({ getCredentials, listCredentials, saveCredentials }),
}));
vi.mock('src/utils/platform', () => ({ isNativeShellActive: () => true }));
vi.mock('src/services/mobileAuth', () => ({ isMobileAuthRuntime: isMobile }));
vi.mock('src/services/clientFingerprint', () => ({ collectClientFingerprint: async () => null, hashClientFingerprint: async () => null }));
vi.mock('src/stores/vault', () => ({ useVaultStore: () => vault }));
vi.mock('src/stores/accounts', () => ({ useAccountsStore: () => ({ saveAccount: async () => {} }) }));
vi.mock('src/utils/accountLifecycle', async (importOriginal) => ({
  ...await importOriginal<object>(), teardownPrivateStores: async () => ({ success: true }),
}));
vi.mock('quasar', () => ({ Notify: { create: vi.fn() } }));

const credentials = { username: 'saved-user', password: 'fixture-only', stayLoggedIn: true };

beforeEach(() => {
  vi.resetAllMocks();
  isMobile.mockReturnValue(false);
  vault.isInitialized = true;
  vi.stubGlobal('localStorage', { setItem: vi.fn(), removeItem: vi.fn() });
  setActivePinia(createPinia());
  listCredentials.mockResolvedValue([credentials]);
  getCredentials.mockResolvedValue(credentials);
});

describe('desktop saved-session recovery', () => {
  it.each([
    { status: 403, data: '<html>Access denied</html>', headers: { 'content-type': 'text/html' } },
    { status: 403, data: { code: 'DEVICE_BINDING_REQUIRED' }, headers: { 'content-type': 'application/json' } },
    { status: 401, data: '<html>Gateway unauthorized</html>', headers: { 'content-type': 'text/html' } },
  ])('preserves the signed-in account on a non-session refusal', async (response) => {
    const auth = useAuthStore();
    Object.assign(auth, { user: { id: 'signed-in' }, isLoggedIn: true });
    get.mockRejectedValueOnce({ response });
    await expect(auth.checkSession()).resolves.toBe(true);
    expect(auth.user?.id).toBe('signed-in');
    expect(auth.authOperationGeneration).toBe(0);
  });

  it('still clears a session the API explicitly invalidated', async () => {
    const auth = useAuthStore();
    Object.assign(auth, { user: { id: 'signed-in' }, isLoggedIn: true });
    get.mockRejectedValueOnce({ response: { status: 401, data: { code: 'AUTH_REQUIRED' }, headers: { 'content-type': 'application/json' } } });
    await expect(auth.checkSession()).resolves.toBe(false);
    expect(auth.user).toBeNull();
  });

  it('does not tear down an initialized mobile Vault when checking the same session', async () => {
    isMobile.mockReturnValue(true);
    const auth = useAuthStore();
    const user = { id: 'signed-in' };
    Object.assign(auth, { user, isLoggedIn: true });
    get.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' }, data: { success: true, data: { user } } });
    await expect(auth.checkSession()).resolves.toBe(true);
    await vi.waitFor(() => expect(vault.initialize).toHaveBeenCalledOnce());
    expect(vault.clearVaultState).not.toHaveBeenCalled();
  });

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

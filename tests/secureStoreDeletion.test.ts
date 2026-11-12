import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createRenderer, ssrContextKey } from 'vue';
import AccountSwitcher from '../src/components/AccountSwitcher.vue';

const f = vi.hoisted(() => ({
  platform: 'mobile', mobileAuth: false, available: true, slots: new Map<string, string>(),
  clearSession: vi.fn(), unregisterPush: vi.fn(),
  remove: vi.fn(), invoke: vi.fn(), notify: vi.fn(), post: vi.fn(),
  teardown: vi.fn(), initialize: vi.fn(), clearVault: vi.fn(), saveAccount: vi.fn(),
  removeAccount: vi.fn(), push: vi.fn(),
}));
vi.mock('../src/utils/platform', () => ({
  isTauriRuntime: () => f.platform === 'desktop',
  isCapacitorRuntime: () => f.platform === 'mobile',
  isNativeShellActive: () => f.platform !== 'web',
}));
vi.mock('../src/services/nativeSecureStorage', () => ({ getSecureStorage: () => f.available ? {
  remove: f.remove,
  set: async (key: string, value: string) => { f.slots.set(key, value); },
  get: async (key: string) => f.slots.get(key) ?? null,
  keys: async () => [...f.slots.keys()],
} : null }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: f.invoke }));
vi.mock('quasar', () => ({ Notify: { create: f.notify } }));
vi.mock('boot/axios', () => ({ api: { post: f.post }, mobilePreAuthApi: {}, refreshMobileSession: vi.fn() }));
vi.mock('../src/services/mobileAuth', () => ({
  isMobileAuthRuntime: () => f.mobileAuth, getMobileSession: async () => null,
  clearMobileSession: f.clearSession,
}));
vi.mock('../src/services/mobilePush', () => ({ unregisterMobilePushToken: f.unregisterPush }));
vi.mock('../src/services/clientFingerprint', () => ({
  hashClientFingerprint: async () => null, collectClientFingerprint: async () => null,
}));
vi.mock('../src/utils/accountLifecycle', async original => ({
  ...await original<Record<string, unknown>>(), teardownPrivateStores: f.teardown,
}));
vi.mock('../src/stores/vault', () => ({ useVaultStore: () => ({
  initialize: f.initialize, clearAllVaultDataForUser: f.clearVault,
}) }));
vi.mock('../src/stores/accounts', () => ({ useAccountsStore: () => ({
  saveAccount: f.saveAccount, removeAccount: f.removeAccount, load: vi.fn(),
}) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: f.push }) }));
vi.mock('../src/composables/useFingerprint', () => ({ useFingerprint: () => ({ getFingerprint: vi.fn() }) }));
vi.mock('../src/composables/useNavigation', () => ({ useNavigation: () => ({ closeSearch: vi.fn() }) }));

import { useSecureStore } from '../src/composables/useSecureStore';
import { useAuthStore } from '../src/stores/auth';
import { useDashboardStore } from '../src/stores/dashboard';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setActivePinia(createPinia());
  f.platform = 'mobile'; f.mobileAuth = false; f.available = true; f.slots.clear();
  f.remove.mockImplementation(async (key: string) => { f.slots.delete(key); });
  f.invoke.mockResolvedValue(undefined);
  f.teardown.mockResolvedValue({ success: true });
  vi.stubGlobal('localStorage', { setItem: vi.fn(), removeItem: vi.fn() });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('persisted credential deletion', () => {
  it('rejects when a native mobile store is unavailable rather than claiming deletion', async () => {
    f.available = false;
    await expect(useSecureStore().removeCredentials('alice')).rejects.toThrow(/secure.*storage.*unavailable/i);
    expect(f.remove).not.toHaveBeenCalled();
  });

  it.each(['mobile', 'desktop'])('propagates %s deletion rejection and preserves retryable credentials', async platform => {
    f.platform = platform;
    const error = new Error('keychain locked');
    f.slots.set('credential:alice', 'saved');
    f.remove.mockRejectedValueOnce(error);
    f.invoke.mockRejectedValueOnce(error);
    await expect(useSecureStore().removeCredentials('alice')).rejects.toBe(error);
    expect(f.slots.get('credential:alice')).toBe('saved');
  });

  it.each(['mobile', 'desktop', 'web'])('deletes successfully on %s without changing namespaces', async platform => {
    f.platform = platform;
    f.slots.set('credential:alice', 'saved');
    await expect(useSecureStore().removeCredentials('alice')).resolves.toBeUndefined();
    if (platform === 'mobile') {
      expect(f.remove).toHaveBeenCalledWith('credential:alice');
      expect(f.slots.has('credential:alice')).toBe(false);
    } else if (platform === 'desktop') {
      expect(f.invoke).toHaveBeenCalledWith('secure_store_remove', { username: 'alice' });
    } else {
      expect(f.remove).not.toHaveBeenCalled();
      expect(f.invoke).not.toHaveBeenCalled();
    }
  });
});

function authenticated() {
  const auth = useAuthStore();
  auth.user = { id: 'alice-id', username: 'alice' } as typeof auth.user;
  auth.isLoggedIn = true;
  vi.spyOn(auth, 'fetchCsrfToken').mockResolvedValue(undefined);
  vi.spyOn(auth, 'postWithFreshCsrf').mockResolvedValue({
    headers: { 'content-type': 'application/json' },
    data: { success: true, data: { user: { id: 'alice-id', username: 'alice' } } },
  } as never);
  return auth;
}

it.each(['mobile', 'desktop', 'unavailable'])('warns about failed stay-logged-in opt-out (%s) without undoing successful online login or vault initialization', async platform => {
  const auth = authenticated();
  f.platform = platform === 'desktop' ? 'desktop' : 'mobile';
  f.available = platform !== 'unavailable';
  f.remove.mockRejectedValueOnce(new Error('keychain locked'));
  f.invoke.mockRejectedValueOnce(new Error('keychain locked'));
  const result = await auth.login({ username: 'alice', password: 'password' }, null, false);
  expect(result.success).toBe(true);
  expect(auth.isLoggedIn).toBe(true);
  expect(auth.user?.id).toBe('alice-id');
  expect(f.saveAccount).toHaveBeenCalledOnce();
  expect(f.initialize).toHaveBeenCalledOnce();
  expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({
    type: 'warning', message: expect.stringMatching(/signed in.*saved credentials.*auto.login/i),
  }));
});

it('reports incomplete device cleanup after server account deletion while still signing out', async () => {
  const auth = authenticated();
  const dashboard = useDashboardStore();
  dashboard.user = { id: 'alice-id', username: 'alice' } as typeof dashboard.user;
  f.post.mockResolvedValue({ data: { success: true } });
  f.remove.mockRejectedValueOnce(new Error('keychain locked'));
  const result = await dashboard.deleteAccount('alice', 'password', 'confirm');
  expect(result).toEqual({ success: false, error: expect.stringMatching(/deleted on the server.*cleanup is incomplete/i) });
  expect(auth.isLoggedIn).toBe(false);
  expect(auth.user).toBeNull();
  expect(f.clearVault).toHaveBeenCalledWith('alice-id');
});

it('warns about failed credential cleanup after a password change without reporting that the server change failed', async () => {
  const auth = authenticated();
  f.post.mockResolvedValue({ data: { success: true, reauthenticationRequired: true } });
  f.remove.mockRejectedValueOnce(new Error('keychain locked'));
  const result = await useDashboardStore().changePassword('password', 'new password');
  expect(result).toEqual({ success: true });
  expect(auth.isLoggedIn).toBe(false);
  expect(auth.user).toBeNull();
  expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({
    type: 'warning', message: expect.stringMatching(/password changed.*saved credentials/i),
  }));
});

// Mount the real script/setup lifecycle with a headless Vue host. Only the
// Quasar visual tree is omitted; the handlers, refs, stores and async calls run.
function switcher() {
  const renderer = createRenderer<object, object>({
    patchProp() {}, insert() {}, remove() {}, setElementText() {}, setText() {},
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    parentNode: () => null, nextSibling: () => null,
  });
  const app = renderer.createApp({ ...AccountSwitcher, render: () => null });
  app.provide(ssrContextKey, { modules: new Set<string>() });
  app.mount({});
  const ui = (app._instance as unknown as { setupState: {
    confirmRemove: (account: { id: string; username: string }) => void;
    doRemove: () => Promise<void>; logoutCurrent: () => Promise<void>;
    showRemoveDialog: boolean; removingAccount: unknown; isSwitching: boolean;
  } }).setupState;
  return { ui, unmount: () => app.unmount() };
}

it('keeps local removal retryable, signs out the active account, and releases the UI lock after deletion rejection', async () => {
  const auth = authenticated();
  f.remove.mockRejectedValueOnce(new Error('keychain locked'));
  const { ui, unmount } = switcher();
  try {
    const account = { id: 'alice-id', username: 'alice' };
    ui.confirmRemove(account);
    await ui.doRemove();
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.user).toBeNull();
    expect(f.clearVault).toHaveBeenCalledWith('alice-id');
    expect(f.removeAccount).not.toHaveBeenCalled();
    expect(ui.showRemoveDialog).toBe(true);
    expect(ui.removingAccount).toEqual(account);
    expect(ui.isSwitching).toBe(false);
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    await ui.doRemove();
    expect(f.removeAccount).toHaveBeenCalledWith('alice-id');
    expect(ui.showRemoveDialog).toBe(false);
    expect(ui.removingAccount).toBeNull();
    expect(ui.isSwitching).toBe(false);
  } finally { unmount(); }
});

it.each(['mobile', 'desktop'])('ordinary %s logout clears the active session and navigates without attempting persisted-credential deletion', async platform => {
  const auth = authenticated();
  f.platform = platform;
  f.mobileAuth = platform === 'mobile';
  f.slots.set('credential:alice', 'saved');
  f.remove.mockRejectedValue(new Error('keychain locked'));
  const { ui, unmount } = switcher();
  try {
    await ui.logoutCurrent();
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.user).toBeNull();
    expect(f.teardown).toHaveBeenCalledOnce();
    if (platform === 'mobile') {
      expect(f.clearSession).toHaveBeenCalledOnce();
      expect(f.unregisterPush).toHaveBeenCalledOnce();
      expect(f.post).toHaveBeenCalledWith('/api/v1/auth/mobile/logout', {}, { withCredentials: false });
    }
    expect(f.push).toHaveBeenCalledWith('/login');
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.slots.get('credential:alice')).toBe('saved');
  } finally { unmount(); }
});

it('successful opt-out removes the real auto-login candidate without affecting online login', async () => {
  const auth = authenticated();
  f.slots.set('credential:alice', JSON.stringify({ username: 'alice', password: 'password', stayLoggedIn: true }));
  expect((await auth.login({ username: 'alice', password: 'password' }, null, false)).success).toBe(true);
  expect(f.notify).not.toHaveBeenCalled();
  await auth.logout();
  const login = vi.spyOn(auth, 'login');
  await expect(auth.autoLogin()).resolves.toBe(false);
  expect(login).not.toHaveBeenCalled();
});

it('auto-login continues to use explicitly opted-in saved credentials through the full login action', async () => {
  const auth = useAuthStore();
  f.slots.set('credential:alice', JSON.stringify({ username: 'alice', password: 'password', stayLoggedIn: true }));
  const login = vi.spyOn(auth, 'login').mockResolvedValue({ success: true });
  await expect(auth.autoLogin()).resolves.toBe(true);
  expect(login).toHaveBeenCalledWith({ username: 'alice', password: 'password' }, null, true);
});

import { beforeEach, expect, test, vi } from 'vitest';
import type { Router } from 'vue-router';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (value: { data: unknown }) => void>(),
  register: vi.fn(async () => {}),
  post: vi.fn(async () => {}),
  storageGet: vi.fn(async (): Promise<string | null> => null),
  banner: vi.fn(),
  fetchInvites: vi.fn(async () => {}),
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  createChannel: async () => {},
  addListener: async (event: string, cb: (value: { data: unknown }) => void) => { mocks.listeners.set(event, cb); },
  checkPermissions: async () => ({ receive: 'granted' }),
  register: mocks.register,
} }));
vi.mock('boot/axios', () => ({ api: { post: mocks.post } }));
vi.mock('src/services/nativeSecureStorage', () => ({ getSecureStorage: () => ({ get: mocks.storageGet }) }));
vi.mock('src/services/mobileAuth', () => ({ isMobileAuthRuntime: () => true }));
vi.mock('src/utils/platform', () => ({ mobilePlatform: () => 'android' }));
vi.mock('src/composables/useArrivalBanner', () => ({ showArrivalBanner: mocks.banner }));
vi.mock('src/stores/auth', () => ({ useAuthStore: () => ({ isLoggedIn: true }) }));
vi.mock('src/stores/vault', () => ({ useVaultStore: () => ({ isInitialized: true, deviceId: 'device', fetchPendingMessages: async () => {} }) }));
vi.mock('src/stores/notifications', () => ({ useNotificationsStore: () => ({ fetchNotifications: async () => {} }) }));
vi.mock('src/stores/links', () => ({ useLinksStore: () => ({ fetchLinks: async () => {} }) }));
vi.mock('src/stores/groupStore', () => ({ useGroupStore: () => ({ fetchMyInvites: mocks.fetchInvites }) }));
vi.mock('src/stores/appSettings', () => ({ useAppSettingsStore: () => ({ hydrate() {}, inAppMessageBanner: true }) }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.listeners.clear();
  vi.stubGlobal('document', { visibilityState: 'visible' });
});

async function receive(data: unknown) {
  const { initializeMobilePush } = await import('../src/services/mobilePush');
  await initializeMobilePush({ push: vi.fn() } as unknown as Router);
  const listener = mocks.listeners.get('pushNotificationReceived');
  expect(listener).toBeDefined();
  listener?.({ data });
}

test('a cached token rejected by the backend does not block native token refresh', async () => {
  mocks.storageGet.mockResolvedValueOnce('old-token');
  mocks.post.mockRejectedValueOnce({ response: { status: 400 } });
  const { syncMobilePushRegistration } = await import('../src/services/mobilePush');
  await syncMobilePushRegistration().catch(() => {});
  expect(mocks.register).toHaveBeenCalledOnce();
});

test('link request with a link ID still shows a foreground banner', async () => {
  await receive({ event: 'LINK_REQUEST', linkId: 'link-1', notificationId: 'notice-1', senderLabel: 'ana' });
  await vi.waitFor(() => expect(mocks.banner).toHaveBeenCalledWith(expect.objectContaining({ body: 'Link request from ana' })));
});

test('a Suite invitation refreshes the inbox even without a realtime frame', async () => {
  await receive({ event: 'GROUP_INVITE', groupId: 'suite-1', inviteId: 'invite-1' });
  await vi.waitFor(() => expect(mocks.fetchInvites).toHaveBeenCalledOnce());
});

test('a legacy Suite control push does not show a generic foreground banner', async () => {
  await receive({ event: 'GROUP_MLS_WELCOME', groupId: 'suite-1' });
  await vi.dynamicImportSettled();
  expect(mocks.banner).not.toHaveBeenCalled();
});

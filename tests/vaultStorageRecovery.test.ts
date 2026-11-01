// tests/vaultStorageRecovery.test.ts
// Storage-recovery behaviour of src/stores/vault.ts, driven through the REAL
// appendMessage / reclaimStorageSpace / clearOldestChats actions with only the
// module boundaries mocked (idb-keyval, offlineVault, attachments, Notify):
//
//   CS-09  "Storage recovered" is only reported when the history write actually
//          succeeded — not merely because attachments were evicted.
//   CS-10  evicting whole conversations is destructive, so it only runs after the
//          user explicitly confirms it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() }));
const notifications = vi.hoisted(() => ({ add: vi.fn() }));
const dialogs = vi.hoisted(() => ({
  create: vi.fn(),
  evict: vi.fn(),
}));
vi.mock('idb-keyval', () => ({ ...storage, update: vi.fn() }));
vi.mock('../src/crypto/offlineVault', () => ({
  getEncryptedRatchetState: vi.fn(),
  setEncryptedRatchetState: vi.fn(),
  removeEncryptedRatchetStates: vi.fn(),
  clearOfflineBlobsForUser: vi.fn(),
}));
vi.mock('../src/composables/useBlobAttachmentCache', () => ({
  purgeAttachmentAccount: vi.fn(),
  purgeAttachmentLink: vi.fn(),
  purgeAttachmentMessage: vi.fn(),
  purgeAttachmentSession: vi.fn(),
  purgeExpiredAttachments: vi.fn(),
  useBlobAttachmentCache: () => ({ evictAttachmentCache: dialogs.evict }),
}));
vi.mock('../src/composables/useArrivalBanner', () => ({ showArrivalBanner: vi.fn() }));
vi.mock('quasar', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Notify: { create: notifications.add },
  Dialog: { create: dialogs.create },
}));
vi.mock('stores/links', () => ({
  useLinksStore: () => ({ links: [], fetchLinks: vi.fn(), updateLinkUnreadCount: vi.fn() }),
}));
vi.mock('stores/notifications', () => ({
  useNotificationsStore: () => ({ addNotification: notifications.add }),
}));
vi.mock('src/stores/appSettings', () => ({
  useAppSettingsStore: () => ({ hydrate: vi.fn(), inAppMessageBanner: false }),
}));
vi.mock('src/utils/notificationSound', () => ({ playNotificationSound: vi.fn(async () => undefined) }));

import { useAuthStore } from '../src/stores/auth';
import { useVaultStore } from '../src/stores/vault';
import { messagesStorageKey } from '../src/utils/storageRecovery';

const UID = 'alice';
const OPEN_LINK = '3d961125-4bf8-4fa8-8f6e-262f082289b2';
const OLD_LINK = '8521da21-0000-1111-2222-333333333333';
const ARRIVAL = {
  id: 'new-arrival',
  senderDeviceId: 'partner-device',
  plaintext: JSON.stringify({ text: 'a new message' }),
  createdAt: 2,
  messageIndex: 1,
  senderDHRPubHex: '00'.repeat(32),
  pn: 0,
  timestamp: 2,
  isSender: false,
};
const quotaError = () => new Error('QuotaExceededError: the quota has been exceeded');

function notificationsTitled(title: string) {
  return notifications.add.mock.calls.filter(
    ([payload]) => (payload as { title?: string })?.title === title,
  );
}

function vaultForQuota() {
  const vault = useVaultStore();
  vault.isInitialized = true;
  vault.deviceId = 'own-device';
  vault.messageLoadState[OPEN_LINK] = 'ready';
  vault.messages[OPEN_LINK] = [];
  vault.linkLastActivity[OPEN_LINK] = 100;
  vi.spyOn(vault, 'loadChatSettings').mockResolvedValue({ mode: 'persistent', muted: true } as never);
  return vault;
}

/** Quasar Dialog.create() returns a chainable dialog whose hooks fire on choice. */
function answerDialog(choice: 'ok' | 'cancel' | 'dismiss') {
  return () => {
    const handlers: Record<string, () => void> = {};
    const chain = {
      onOk: (fn: () => void) => ((handlers.ok = fn), chain),
      onCancel: (fn: () => void) => ((handlers.cancel = fn), chain),
      onDismiss: (fn: () => void) => ((handlers.dismiss = fn), chain),
    };
    setTimeout(() => handlers[choice]?.(), 0);
    return chain;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  Object.assign(useAuthStore(), { user: { id: UID }, isLoggedIn: true });
  storage.get.mockResolvedValue(undefined);
  storage.set.mockResolvedValue(undefined);
  storage.del.mockResolvedValue(undefined);
  storage.keys.mockResolvedValue([]);
  dialogs.evict.mockResolvedValue(2);
  vi.stubGlobal('sessionStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CS-09 storage recovery is reported only for a real recovery', () => {
  it('does not claim recovery when attachments were evicted but history still cannot be written', async () => {
    const vault = vaultForQuota();
    // Every history write fails, even after the attachment cache was dropped.
    vi.spyOn(vault, 'persistMessages').mockRejectedValue(quotaError());
    vi.spyOn(vault, 'clearOldestChats').mockResolvedValue(0);

    await vault.appendMessage(OPEN_LINK, ARRIVAL);

    expect(dialogs.evict).toHaveBeenCalledTimes(1);
    expect(notificationsTitled('Storage recovered')).toHaveLength(0);
    const full = notificationsTitled('Device storage full');
    expect(full).toHaveLength(1);
    expect(String((full[0][0] as { message?: string }).message)).toContain('could not save');
    // The message is still in memory for this session.
    expect(vault.messages[OPEN_LINK].map((m) => m.id)).toEqual([ARRIVAL.id]);
  });

  it('reports recovery with what was freed when the retry after eviction succeeds', async () => {
    const vault = vaultForQuota();
    vi.spyOn(vault, 'persistMessages')
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValue(undefined);

    await vault.appendMessage(OPEN_LINK, ARRIVAL);

    expect(notificationsTitled('Device storage full')).toHaveLength(0);
    const recovered = notificationsTitled('Storage recovered');
    expect(recovered).toHaveLength(1);
    expect(String((recovered[0][0] as { message?: string }).message)).toContain('2 cached attachments');
  });
});

describe('CS-10 destructive history eviction is gated', () => {
  it('never deletes conversations when the user declines the confirmation', async () => {
    const vault = vaultForQuota();
    const openKey = messagesStorageKey(OPEN_LINK, UID);
    const oldKey = messagesStorageKey(OLD_LINK, UID);
    storage.keys.mockResolvedValue([openKey, oldKey]);
    // Attachment eviction frees nothing, so history eviction is the only option.
    dialogs.evict.mockResolvedValue(0);
    vi.spyOn(vault, 'persistMessages').mockRejectedValue(quotaError());
    dialogs.create.mockImplementation(answerDialog('cancel'));

    await vault.appendMessage(OPEN_LINK, ARRIVAL);

    expect(dialogs.create).toHaveBeenCalledTimes(1);
    expect(storage.del).not.toHaveBeenCalledWith(oldKey);
    expect(storage.del).not.toHaveBeenCalledWith(openKey);
    expect(notificationsTitled('Storage recovered')).toHaveLength(0);
    expect(notificationsTitled('Device storage full')).toHaveLength(1);
  });

  it('evicts only the oldest other conversation after an explicit confirmation', async () => {
    const vault = vaultForQuota();
    const openKey = messagesStorageKey(OPEN_LINK, UID);
    const oldKey = messagesStorageKey(OLD_LINK, UID);
    storage.keys.mockResolvedValue([openKey, oldKey]);
    dialogs.evict.mockResolvedValue(0);
    vi.spyOn(vault, 'persistMessages')
      .mockRejectedValueOnce(quotaError())
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValue(undefined);
    dialogs.create.mockImplementation(answerDialog('ok'));

    await vault.appendMessage(OPEN_LINK, ARRIVAL);

    // One question, only about the other conversation.
    expect(dialogs.create).toHaveBeenCalledTimes(1);
    expect(String((dialogs.create.mock.calls[0][0] as { message?: string }).message)).toContain(
      '1 other chat',
    );
    expect(storage.del).toHaveBeenCalledWith(oldKey);
    expect(storage.del).not.toHaveBeenCalledWith(openKey);
    const recovered = notificationsTitled('Storage recovered');
    expect(recovered).toHaveLength(1);
    expect(String((recovered[0][0] as { message?: string }).message)).toContain('1 old chat');
  });

  it('does not prompt or delete anything when there is no other conversation to evict', async () => {
    const vault = vaultForQuota();
    storage.keys.mockResolvedValue([messagesStorageKey(OPEN_LINK, UID)]);
    dialogs.evict.mockResolvedValue(0);
    vi.spyOn(vault, 'persistMessages').mockRejectedValue(quotaError());

    await vault.appendMessage(OPEN_LINK, ARRIVAL);

    expect(dialogs.create).not.toHaveBeenCalled();
    expect(storage.del).not.toHaveBeenCalled();
    expect(notificationsTitled('Device storage full')).toHaveLength(1);
  });
});

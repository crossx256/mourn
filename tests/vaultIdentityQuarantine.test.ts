// tests/vaultIdentityQuarantine.test.ts
// CS-03: a TOFU identity-pin mismatch must be recoverable, and the quarantined
// frames (the only copy of that ciphertext) must survive a store clear such as a
// restart or mobile reauth failure.
//
//   - later frames from the same device are not chained behind a quarantined one,
//   - a re-pin ("trust this new identity") releases the link and re-decrypts,
//   - the persisted quarantine is account-scoped, encrypted (opaque) at rest, and
//     restored on the next vault session.
//
// Driven through the REAL store actions with module boundaries mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { toRaw } from 'vue';
import sodium from 'libsodium-wrappers';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() }));
const offline = vi.hoisted(() => ({ getEncryptedRatchetState: vi.fn() }));
const notifications = vi.hoisted(() => ({ add: vi.fn() }));
const linksState = vi.hoisted(() => ({ links: [] as unknown[] }));
vi.mock('idb-keyval', () => ({ ...storage, update: vi.fn() }));
vi.mock('../src/crypto/offlineVault', () => ({
  ...offline,
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
  useBlobAttachmentCache: () => ({ evictAttachmentCache: vi.fn() }),
}));
vi.mock('../src/composables/useArrivalBanner', () => ({ showArrivalBanner: vi.fn() }));
vi.mock('quasar', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Notify: { create: notifications.add },
  Dialog: { create: vi.fn() },
}));
vi.mock('stores/links', () => ({
  useLinksStore: () => ({
    links: linksState.links,
    fetchLinks: vi.fn(async () => undefined),
    updateLinkUnreadCount: vi.fn(),
  }),
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
import { KeyManager } from '../src/crypto/keys';

// Key derivation (and sealing) awaits libsodium; give the store time to settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

const OWN_DEVICE = 'own-device';
const PARTNER_DEVICE = 'partner-device';
const PINNED = 'ab'.repeat(32);
const ROTATED = 'cd'.repeat(32);
const PACKET_BASE = {
  senderDeviceId: PARTNER_DEVICE,
  ciphertextHex: '00'.repeat(16),
  nonceHex: '00'.repeat(24),
  messageIndex: 0,
  senderDHRPubHex: '00'.repeat(32),
  pn: 0,
  createdAt: 1_700_000_000_000,
};

function link() {
  return {
    id: 'L',
    status: 'ANCHORED',
    senderId: 'alice',
    receiverId: 'bob',
    sender: { id: 'alice', devices: [{ id: OWN_DEVICE, devicePub: 'aa'.repeat(32) }] },
    receiver: {
      id: 'bob',
      devices: [{ id: PARTNER_DEVICE, devicePub: 'bb'.repeat(32), identityPub: ROTATED }],
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
  storage.get.mockResolvedValue(undefined);
  storage.set.mockResolvedValue(undefined);
  storage.keys.mockResolvedValue([]);
  linksState.links = [link()];
  vi.stubGlobal('sessionStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('indexedDB', {});
  vi.stubGlobal('crypto', globalThis.crypto);
  await sodium.ready;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A vault pinned to the ORIGINAL partner identity, with no engine yet. */
function vaultWithRotatedPartner() {
  const vault = useVaultStore();
  vault.deviceId = OWN_DEVICE;
  vault.isInitialized = true;
  vault.connectionError = null;
  vault.sessionId = 'session-1';
  vault.messageLoadState.L = 'ready';
  vault.messages.L = [];
  vault.trustedPartnerIdentities.L = PINNED;
  vault.trustedDeviceIdentities.L = { [PARTNER_DEVICE]: PINNED };
  vault.transport = {
    ackMessage: vi.fn(),
    nackMessage: vi.fn(),
    sendEncryptedPayloadToUser: vi.fn(),
  } as never;
  offline.getEncryptedRatchetState.mockResolvedValue(null);
  vault.keyManager = new KeyManager();
  vi.spyOn(vault.keyManager, 'getStoredKey').mockResolvedValue(
    sodium.from_hex('11'.repeat(32)),
  );
  vi.spyOn(vault, 'persistMessages').mockResolvedValue(undefined);
  vi.spyOn(vault, 'persistEngineState').mockResolvedValue(undefined);
  vi.spyOn(vault, 'loadChatSettings').mockResolvedValue({ mode: 'persistent', muted: true } as never);
  const decrypt = vi.spyOn(vault, 'decryptIncomingPacket').mockResolvedValue(undefined);
  return { vault, decrypt };
}

describe('CS-03 a TOFU identity mismatch does not deadlock the link', () => {
  it('quarantines the mismatching frame and does not chain the NEXT one behind it', async () => {
    const { vault, decrypt } = vaultWithRotatedPartner();
    // The frame that exposed the rotation.
    await vault.handleIncomingMessage({ ...PACKET_BASE, id: 'relay-1', linkId: 'L' });
    await settle();
    expect(decrypt).not.toHaveBeenCalled();
    expect(vault.quarantinedMessages.L).toHaveLength(1);
    expect(vault.isLinkCompromised('L')).toBe(true);

    // The user does not answer; the device's next frame arrives. Because the
    // mismatching frame was never decrypted, the ratchet is exactly where the
    // link left it — so the new frame must not be chained behind a frame that
    // can never decrypt (that was the silent deadlock), and it must not be
    // forwarded to decryption either (it belongs to the same rotated device).
    const release = vi.spyOn(vault, 'queueQuarantinedMessage');

    await vault.handleIncomingMessage({ ...PACKET_BASE, id: 'relay-2', linkId: 'L' });
    await settle();

    // relay-2 took its own quarantine path. It is NOT queued behind relay-1:
    // the store's engine-keyed decrypt queue is empty.
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][1].id).toBe('relay-2');
    expect(decrypt).not.toHaveBeenCalled();
    expect(vault.decryptQueueByEngine.size).toBe(0);
  });

  it('releases a quarantined frame through the temporary-safety window without chaining it', async () => {
    const { vault, decrypt } = vaultWithRotatedPartner();
    await vault.handleIncomingMessage({ ...PACKET_BASE, id: 'relay-1', linkId: 'L' });
    await settle();
    expect(vault.quarantinedMessages.L).toHaveLength(1);

    // The user chose the 5-minute "keep messaging" window instead of deciding.
    await vault.allowMessagingTemp('L');

    const release = vi.spyOn(vault, 'queueQuarantinedMessage');
    await vault.handleIncomingMessage({ ...PACKET_BASE, id: 'relay-2', linkId: 'L' });
    await settle();

    // The window does not authorise decrypting an unapproved identity: the frame
    // is still quarantined, and it is NOT chained behind relay-1.
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][1].id).toBe('relay-2');
    expect(decrypt).not.toHaveBeenCalled();
    expect(vault.decryptQueueByEngine.size).toBe(0);
    expect((vault.quarantinedMessages.L ?? []).map((e) => e.packet.id)).toEqual([
      'relay-1',
      'relay-2',
    ]);

    // Two traps feed the chaining deadlock: a placeholder queued for a frame that
    // is never decrypted, and a redelivery re-entering that queue.
    const placeholder = { then() {} } as unknown as Promise<void>;
    vault.decryptQueueByEngine.set(`L_${PARTNER_DEVICE}`, placeholder);
    await vault.handleIncomingMessage({ ...PACKET_BASE, id: 'relay-2', linkId: 'L' });
    await settle();
    // toRaw: a Map held in reactive state hands back a proxy of its values.
    expect(toRaw(vault.decryptQueueByEngine.get(`L_${PARTNER_DEVICE}`))).toBe(placeholder);
  });

  it('bounds the quarantine instead of growing without limit', async () => {
    const { vault } = vaultWithRotatedPartner();
    for (let i = 0; i < 260; i += 1) {
      await vault.handleIncomingMessage({ ...PACKET_BASE, id: `relay-${i}`, linkId: 'L' });
    }
    const queued = vault.quarantinedMessages.L;
    expect(queued.length).toBeLessThanOrEqual(200);
    expect(queued.some((entry) => entry.packet.id === 'relay-259')).toBe(true);
    expect(queued.some((entry) => entry.packet.id === 'relay-0')).toBe(false);
  });

  it('a re-pin releases the link and re-decrypts the quarantined frames with EACH frame’s own key', async () => {
    const { vault, decrypt } = vaultWithRotatedPartner();
    // Two distinct devices on the rotated identity (phone + reinstall), so the
    // release must not decrypt every frame with one device's key.
    const OTHER_DEVICE = 'partner-device-2';
    vault.trustedDeviceIdentities.L = { [PARTNER_DEVICE]: PINNED, [OTHER_DEVICE]: PINNED };
    const otherLink = link();
    otherLink.receiver.devices.push({ id: OTHER_DEVICE, devicePub: 'dd'.repeat(32), identityPub: ROTATED } as never);
    linksState.links = [otherLink];

    await vault.handleIncomingMessage({ ...PACKET_BASE, id: 'relay-1', linkId: 'L' });
    await vault.handleIncomingMessage({
      ...PACKET_BASE,
      id: 'relay-2',
      linkId: 'L',
      senderDeviceId: OTHER_DEVICE,
    });
    await settle();
    expect(vault.quarantinedMessages.L).toHaveLength(2);

    // The partner reinstalled: the user trusts the new identity key. The re-pin
    // is recorded per device (the exact device the user was shown).
    await vault.markLinkSafe('L', ROTATED);
    vault.trustedDeviceIdentities.L = { [PARTNER_DEVICE]: ROTATED };
    await settle();

    expect(vault.quarantinedMessages.L).toHaveLength(0);
    expect(decrypt).toHaveBeenCalledTimes(2);
    const keys = Object.fromEntries(decrypt.mock.calls.map((call) => [call[1].id, call[2]]));
    expect(keys['relay-1']).toBe('bb'.repeat(32));
    expect(keys['relay-2']).toBe('dd'.repeat(32));

    // The re-pinned identity is what future frames are checked against.
    await vault.handleIncomingMessage({ ...PACKET_BASE, id: 'relay-3', linkId: 'L' });
    await settle();
    expect(decrypt).toHaveBeenCalledTimes(3);
    expect(vault.quarantinedMessages.L ?? []).toHaveLength(0);
  });

  it('rejecting the new identity clears the quarantine without decrypting it', async () => {
    const { vault, decrypt } = vaultWithRotatedPartner();
    await vault.handleIncomingMessage({ ...PACKET_BASE, id: 'relay-1', linkId: 'L' });
    expect(vault.quarantinedMessages.L).toHaveLength(1);

    vault.rejectQuarantinedMessages('L');

    expect(vault.quarantinedMessages.L ?? []).toHaveLength(0);
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe('CS-03 the quarantine survives a store clear, encrypted at rest', () => {
  it('persists the quarantine opaquely and restores it in the next vault session', async () => {
    const { vault } = vaultWithRotatedPartner();
    await vault.handleIncomingMessage({ ...PACKET_BASE, id: 'relay-1', linkId: 'L' });
    expect(vault.quarantinedMessages.L).toHaveLength(1);
    await vault.persistQuarantinedMessages('L');

    // Nothing but the ciphertext may reach storage, and it must be wrapped.
    const writes = storage.set.mock.calls.filter(([key]) =>
      String(key).startsWith('vault_quarantine'),
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const [, value] of writes) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain(PACKET_BASE.ciphertextHex);
      expect(serialized).not.toContain(PACKET_BASE.senderDHRPubHex);
      expect(serialized).not.toContain(PARTNER_DEVICE);
      expect(serialized).not.toContain(ROTATED);
      expect(serialized).not.toContain('relay-1');
    }
    // Account-scoped key.
    expect(String(writes.at(-1)?.[0])).toContain('alice');

    // Restart / mobile reauth: the in-memory store is torn down.
    await vault.clearVaultState('alice');
    expect(vault.quarantinedMessages.L ?? []).toHaveLength(0);

    // Simulate the durable record surviving the restart.
    const written = writes.at(-1)?.[1];
    storage.get.mockImplementation(async (key: string) =>
      String(key).startsWith('vault_quarantine') ? written : undefined,
    );
    linksState.links = [link()];
    const reopened = useVaultStore();
    reopened.isInitialized = true;
    reopened.keyManager = new KeyManager();
    vi.spyOn(reopened.keyManager, 'getStoredKey').mockResolvedValue(sodium.from_hex('11'.repeat(32)));
    reopened.trustedPartnerIdentities.L = PINNED;
    reopened.trustedDeviceIdentities.L = { [PARTNER_DEVICE]: PINNED };
    const decrypt = vi.spyOn(reopened, 'decryptIncomingPacket').mockResolvedValue(undefined);

    await reopened.restoreQuarantinedMessages();

    expect(reopened.quarantinedMessages.L).toHaveLength(1);
    expect(reopened.quarantinedMessages.L[0].packet.id).toBe('relay-1');
    expect(reopened.isLinkCompromised('L')).toBe(true);

    // And the restored frames are still releasable.
    await reopened.markLinkSafe('L', ROTATED);
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt.mock.calls[0][1].id).toBe('relay-1');
  });

  it('never restores another account’s quarantine', async () => {
    storage.get.mockImplementation(async (key: string) =>
      String(key).includes('bob') ? '{"sealed":"x"}' : undefined,
    );
    const vault = useVaultStore();
    vault.isInitialized = true;
    linksState.links = [link()];

    await vault.restoreQuarantinedMessages();

    expect(vault.quarantinedMessages.L ?? []).toHaveLength(0);
  });
});

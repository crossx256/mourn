// tests/vaultInbound.test.ts
// Inbound delivery invariants for src/stores/vault.ts, driven through the REAL
// store actions with only the module boundaries mocked (libsodium, idb-keyval,
// offlineVault ratchet storage, links/auth stores, transport):
//
//   CS-01  the pending-fetch mapping must carry the server's `outgoing` flag
//   CS-02  a failure exit must roll back the attempted/processed markers so the
//          relay's redelivery is NOT suppressed for the rest of the session
//   CS-04  frames buffered while the vault is uninitialized are bounded
//   CS-07  self-sync copies dedupe by id, never by (body, ±2 s)
//   CS-08  a history envelope from a PARTNER device is not local history
//
// Run: bunx vitest run tests/vaultInbound.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { toRaw } from 'vue';
import sodium from 'libsodium-wrappers';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() }));
const notifications = vi.hoisted(() => ({ add: vi.fn() }));
const linksState = vi.hoisted(() => ({ links: [] as unknown[] }));
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
  useBlobAttachmentCache: () => ({ evictAttachmentCache: vi.fn() }),
}));
vi.mock('../src/composables/useArrivalBanner', () => ({ showArrivalBanner: vi.fn() }));
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
import { getEncryptedRatchetState } from '../src/crypto/offlineVault';
import { buildHistoryEnvelope } from '../src/crypto/selfSession';

const OWN_DEVICE = 'own-device';
const PARTNER_DEVICE = 'partner-device';
const PARTNER_IDENTITY = 'ab'.repeat(32);
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
      devices: [{ id: PARTNER_DEVICE, devicePub: 'bb'.repeat(32), identityPub: PARTNER_IDENTITY }],
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
  await sodium.ready;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A store wired for inbound delivery: initialized, pinned partner, ready history. */
function inboundVault() {
  const vault = useVaultStore();
  vault.deviceId = OWN_DEVICE;
  vault.isInitialized = true;
  vault.connectionError = null;
  vault.messageLoadState.L = 'ready';
  vault.messages.L = [];
  vault.trustedPartnerIdentities.L = PARTNER_IDENTITY;
  vault.trustedDeviceIdentities.L = { [PARTNER_DEVICE]: PARTNER_IDENTITY };
  const transport = { ackMessage: vi.fn(), nackMessage: vi.fn(), sendEncryptedPayloadToUser: vi.fn() };
  vault.transport = transport as never;
  // A plain object in reactive state is handed back as a proxy; toRaw() is how
  // the store's own identity comparisons see it.
  const heldTransport = () => toRaw(vault.transport as never);
  vi.spyOn(vault, 'persistMessages').mockResolvedValue(undefined);
  vi.spyOn(vault, 'persistEngineState').mockResolvedValue(undefined);
  vi.spyOn(vault, 'loadChatSettings').mockResolvedValue({ mode: 'persistent', muted: true });
  vi.mocked(getEncryptedRatchetState).mockResolvedValue(null);
  return { vault, transport, heldTransport };
}

describe('CS-01 pending-fetch mapping keeps the outgoing self-sync flag', () => {
  it('decrypts an own-device pending row on the self_ engine and stores it as sent', async () => {
    const { vault } = inboundVault();
    const { api } = await import('boot/axios');
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url === '/api/v1/vault/messages/pending') {
        return {
          data: {
            data: [
              {
                ...PACKET_BASE,
                id: 'relay-self-1',
                linkId: 'L',
                senderDeviceId: 'other-own-device',
                outgoing: true,
              },
            ],
          },
        };
      }
      return { data: {} };
    });
    vi.spyOn(useAuthStore(), 'fetchCsrfToken').mockResolvedValue(undefined as never);
    // The other own device is not (yet) in the link's device lists.
    linksState.links = [
      {
        ...link(),
        sender: { id: 'alice', devices: [{ id: OWN_DEVICE, devicePub: 'aa'.repeat(32) }] },
        receiver: {
          id: 'bob',
          devices: [{ id: PARTNER_DEVICE, devicePub: 'bb'.repeat(32), identityPub: PARTNER_IDENTITY }],
        },
      },
    ];
    const decrypt = vi.spyOn(vault, 'decryptIncomingPacket').mockResolvedValue(undefined);
    vault.getEngine = vi.fn();
    vault.getOwnVaultDevices = vi.fn(async () => [
      { id: OWN_DEVICE, devicePub: 'aa'.repeat(32), platform: 'UNKNOWN' },
      { id: 'other-own-device', devicePub: 'cc'.repeat(32), platform: 'ANDROID' },
    ]);

    await vault.fetchPendingMessages();
    expect(decrypt).toHaveBeenCalledTimes(1);
    const [linkId, packet] = decrypt.mock.calls[0];
    expect(linkId).toBe('L');
    expect(packet.id).toBe('relay-self-1');
    expect(packet.outgoing).toBe(true);
    // Decryption ran on the self-session engine, not the partner engine.
    expect(decrypt.mock.calls[0][2]).toBe('cc'.repeat(32));
    expect(vault.decryptQueueByEngine.size).toBe(0);
  });
});

describe('CS-02 failure exits roll back the inbound markers', () => {
  it('does not suppress the relay redelivery after a decrypt-queue failure', async () => {
    const { vault, transport, heldTransport } = inboundVault();
    const failing = vi
      .spyOn(vault, 'decryptIncomingPacket')
      .mockRejectedValueOnce(new Error('transient decrypt failure'));
    const packet = { ...PACKET_BASE, id: 'relay-retry-1', linkId: 'L' };

    await expect(vault.handleIncomingMessage(packet)).rejects.toThrow('transient decrypt failure');
    expect(failing).toHaveBeenCalledTimes(1);
    expect(vault.attemptedMessageIds.has(packet.id)).toBe(false);
    expect(vault.processedMessageIds[packet.id]).toBeUndefined();

    // Redelivery of the same relay id must be processed, not skipped.
    failing.mockResolvedValueOnce(undefined);
    await vault.handleIncomingMessage(packet);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('does not suppress the relay redelivery when the packet is malformed', async () => {
    const { vault } = inboundVault();
    const packet = { ...PACKET_BASE, id: 'relay-bad-index', linkId: 'L', messageIndex: -1 };
    const decrypt = vi.spyOn(vault, 'decryptIncomingPacket').mockResolvedValue(undefined);

    await vault.handleIncomingMessage(packet);
    expect(decrypt).not.toHaveBeenCalled();
    expect(vault.attemptedMessageIds.has(packet.id)).toBe(false);
    expect(vault.processedMessageIds[packet.id]).toBeUndefined();
  });

  it('does not suppress the relay retry when the plaintext cannot be persisted', async () => {
    const { vault } = inboundVault();
    // Let the real appendMessage + commitReceipt run; the ratchet checkpoint
    // read succeeds but the durable message write is refused.
    vault.persistMessages.mockRejectedValue(new Error('storage offline'));
    vault.persistEngineState.mockRestore();
    const engine = {
      exportRatchetState: () => ({ Ns: 0, Nr: 0, PN: 0, DHr_pubHex: null, CKr_hex: null, MKSKIPPED: [] }),
      importRatchetState: vi.fn(async () => undefined),
      decryptFrame: vi.fn(async () => 'persist me never'),
    };
    vault.engines[`L_${PARTNER_DEVICE}`] = engine as never;
    const packet = { ...PACKET_BASE, id: 'relay-persist-1', linkId: 'L' };
    const ack = (vault.transport as unknown as { ackMessage: ReturnType<typeof vi.fn> }).ackMessage;

    await vault.handleIncomingMessage(packet);

    expect(engine.decryptFrame).toHaveBeenCalledTimes(1);
    expect(vault.persistMessages).toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
    expect(vault.attemptedMessageIds.has(packet.id)).toBe(false);
    expect(vault.processedMessageIds[packet.id]).toBeUndefined();
    expect(vault.realtimeBuffer.some((p) => p.id === packet.id)).toBe(true);
  });
});

describe('CS-04 frames buffered before initialization are bounded', () => {
  it('keeps only the newest frames and drops the oldest', async () => {
    const { vault } = inboundVault();
    vault.isInitialized = false;
    for (let i = 0; i < 250; i += 1) {
      await vault.handleIncomingMessage({ ...PACKET_BASE, id: `relay-${i}`, linkId: 'L' });
    }
    expect(vault.realtimeBuffer.length).toBeLessThanOrEqual(200);
    expect(vault.realtimeBuffer.some((p) => p.id === 'relay-249')).toBe(true);
    expect(vault.realtimeBuffer.some((p) => p.id === 'relay-0')).toBe(false);
  });
});

describe('CS-07 self-sync copies dedupe by id', () => {
  it('keeps two sent messages with the same text 1.5 s apart', async () => {
    const { vault } = inboundVault();
    const base = 1_700_000_000_000;
    const envelope = (text: string) => JSON.stringify({ v: 1, text, type: 'text' });

    await vault.ingestSilentSelfMessage(
      'L',
      { ...PACKET_BASE, id: 'relay-a', outgoing: true, createdAt: base },
      envelope('ok'),
    );
    await vault.ingestSilentSelfMessage(
      'L',
      { ...PACKET_BASE, id: 'relay-b', outgoing: true, createdAt: base + 1500 },
      envelope('ok'),
    );

    expect(vault.messages.L.map((m) => m.id)).toEqual(['relay-a', 'relay-b']);
    expect(vault.messages.L.every((m) => m.isSender)).toBe(true);
  });

  it('still collapses a repeated self-sync copy of the same relay id', async () => {
    const { vault } = inboundVault();
    const base = 1_700_000_000_000;
    const envelope = JSON.stringify({ v: 1, text: 'ok', type: 'text' });
    await vault.ingestSilentSelfMessage('L', { ...PACKET_BASE, id: 'relay-a', outgoing: true, createdAt: base }, envelope);
    await vault.ingestSilentSelfMessage('L', { ...PACKET_BASE, id: 'relay-a', outgoing: true, createdAt: base }, envelope);
    expect(vault.messages.L).toHaveLength(1);
  });
});

describe('CS-08 history envelopes from a partner device are not local history', () => {
  it('treats a partner-authored history envelope as an ordinary inbound message', async () => {
    const { vault } = inboundVault();
    const forged = buildHistoryEnvelope({
      ts: 1_600_000_000_000,
      fromSelf: true,
      body: 'planted into your own history',
    });

    const silent = await vault.ingestSilentSelfMessage(
      'L',
      { ...PACKET_BASE, id: 'relay-forged' },
      forged,
    );

    expect(silent).toBe(false);
    expect(vault.messages.L).toHaveLength(0);
  });

  it('still ingests a history envelope that arrived on the self-sync channel', async () => {
    const { vault } = inboundVault();
    const envelope = buildHistoryEnvelope({ ts: 1_600_000_000_000, fromSelf: false, body: 'from bob' });

    const silent = await vault.ingestSilentSelfMessage(
      'L',
      { ...PACKET_BASE, id: 'relay-self-hist', outgoing: true },
      envelope,
    );

    expect(silent).toBe(true);
    expect(vault.messages.L).toHaveLength(1);
    expect(vault.messages.L[0].plaintext).toBe('from bob');
    expect(vault.messages.L[0].isSender).toBe(false);
  });
});

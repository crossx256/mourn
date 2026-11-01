import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import sodium from 'libsodium-wrappers';
import type * as OfflineVaultModule from '../src/crypto/offlineVault';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() }));
vi.mock('idb-keyval', () => ({ ...storage, update: vi.fn() }));
vi.mock('../src/crypto/offlineVault', () => ({
  getEncryptedRatchetState: vi.fn(), setEncryptedRatchetState: vi.fn(),
  removeEncryptedRatchetStates: vi.fn(), clearOfflineBlobsForUser: vi.fn(),
}));
vi.mock('../src/composables/useBlobAttachmentCache', () => ({
  useBlobAttachmentCache: vi.fn(), purgeAttachmentSession: vi.fn(),
  purgeExpiredAttachments: vi.fn(), purgeAttachmentAccount: vi.fn(),
  purgeAttachmentLink: vi.fn(), purgeAttachmentMessage: vi.fn(),
}));
import { useAuthStore } from '../src/stores/auth';
import { useVaultStore } from '../src/stores/vault';
import { VaultTransport } from '../src/crypto/transport';
import { api } from '../src/boot/axios';
import { CipherEngine } from '../src/crypto/engine';
import { getEncryptedRatchetState, setEncryptedRatchetState } from '../src/crypto/offlineVault';
import * as platform from '../src/utils/platform';
import * as nativeStorage from '../src/services/nativeSecureStorage';

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(getEncryptedRatchetState).mockReset();
  vi.mocked(setEncryptedRatchetState).mockReset().mockResolvedValue(undefined);
  setActivePinia(createPinia());
  Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
  storage.get.mockResolvedValue(undefined);
  storage.set.mockResolvedValue(undefined);
  storage.keys.mockResolvedValue([]);
  vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('sessionStorage', { removeItem: vi.fn() });
  await sodium.ready;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const real = { id: 'msg_real', senderId: 'alice', senderDeviceId: 'desktop', plaintext: JSON.stringify({ text: 'hello' }), timestamp: 1000, isSender: true };
const history = { ...real, id: 'hist_copy', plaintext: 'hello' };
const arrival = { ...real, id: 'msg_arrival', plaintext: 'new', timestamp: 2000 };

function setupHistory() {
  const vault = useVaultStore();
  vi.spyOn(vault, 'loadChatSettings').mockResolvedValue(null);
  vi.spyOn(vault, 'backfillLegacySenderIds').mockResolvedValue(undefined);
  vi.spyOn(vault, 'persistUnreadState').mockResolvedValue(undefined);
  return vault;
}

describe('main + hardening Vault integration', () => {
  it('merges durable history and arrivals, then dedupes history copies before writing', async () => {
    const vault = setupHistory();
    storage.get.mockResolvedValue([history, real]);
    vault.messages.link = [arrival];
    await vault.loadMessages('link');
    expect(vault.messages.link?.map(message => message.id)).toEqual(['msg_real', 'msg_arrival']);
    expect(storage.set).toHaveBeenLastCalledWith('vault_messages_link_uid_alice', [
      expect.objectContaining(real),
      expect.objectContaining(arrival),
    ]);
  });

  it('keeps a malformed original record despite a dedupe opportunity', async () => {
    const vault = setupHistory();
    storage.get.mockResolvedValue([history, real, { damaged: true }]);
    await expect(vault.loadMessages('link')).rejects.toThrow('replacement writes blocked');
    expect(vault.messageLoadState.link).toBe('error');
    expect(storage.set).not.toHaveBeenCalled();
    await vault.appendMessage('link', arrival);
    expect(vault.messages.link).toEqual([arrival]);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('replaces a backfilled twin with its authoritative live id without losing other rows', async () => {
    const vault = setupHistory();
    vault.messageLoadState.link = 'ready';
    vault.messages.link = [history, arrival];
    await vault.appendMessage('link', real);
    expect(vault.messages.link?.map(message => message.id)).toEqual(['msg_real', 'msg_arrival']);
  });

  it('does not overwrite other device pins when pinning a newly seen device', async () => {
    const vault = useVaultStore();
    storage.get.mockResolvedValue({ phone: 'a'.repeat(64) });
    await vault.setTrustedDeviceIdentity('link', 'desktop', 'b'.repeat(64));
    expect(storage.set).toHaveBeenCalledWith('vault_trusted_device_identity_link_uid_alice', {
      phone: 'a'.repeat(64), desktop: 'b'.repeat(64),
    });
  });

  it('rejects a device-pin read that completes after an account transition', async () => {
    const vault = useVaultStore();
    let finish!: (pins: Record<string, string>) => void;
    storage.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = vault.getTrustedDeviceIdentity('link', 'phone');
    const rejected = expect(pending).rejects.toThrow('superseded');
    useAuthStore().authOperationGeneration++;
    finish({ phone: 'a'.repeat(64) });
    await rejected;
    expect(vault.trustedDeviceIdentities).toEqual({});
  });

  it('retains enrolled device storage on transient authorization drift', async () => {
    const vault = useVaultStore();
    vault.deviceId = 'enrolled-device';
    vault.deviceToken = 'expired-token';
    await vault.clearStaleDeviceIdentity();
    expect(vault.deviceId).toBeNull();
    expect(vault.deviceToken).toBeNull();
    expect(storage.del).not.toHaveBeenCalled();
  });

  it.each(['success', '403', 'csrf403', 'device', 'transport', 'generation'])('fences obsolete pending fetch continuations: %s', async (kind) => {
    const vault = useVaultStore();
    vault.deviceId = 'alice-device';
    let finish!: (value?: unknown) => void;
    const deferred = new Promise((resolve, reject) => {
      finish = kind === 'success' ? resolve : () => reject({ response: { status: 403 } });
    });
    const csrf = vi.spyOn(useAuthStore(), 'fetchCsrfToken').mockResolvedValue(undefined);
    const get = vi.spyOn(api, 'get').mockImplementation(() => deferred as never);
    if (kind === 'csrf403') csrf.mockImplementationOnce(() => deferred as Promise<void>);
    const incoming = vi.spyOn(vault, 'handleIncomingMessage').mockResolvedValue(undefined);
    const pending = vault.fetchPendingMessages();
    await vi.waitFor(() => expect(kind === 'csrf403' ? csrf : get).toHaveBeenCalled());
    if (kind === 'device') vault.deviceId = 'replacement-device';
    else if (kind === 'transport') vault.transport = { ackMessage: vi.fn() } as never;
    else {
      useAuthStore().authOperationGeneration++;
      if (kind !== 'generation') {
        useAuthStore().user = { id: 'bob' } as never;
        vault.deviceId = 'bob-device';
      }
    }
    const device = vault.deviceId;
    vault.deviceToken = 'current-token';
    vault.connectionError = 'current-error';
    vault.pendingFetchInProgress = true;
    const buffered = { id: 'current-buffer' } as never;
    vault.realtimeBuffer = [buffered];
    finish({ data: { data: [{ id: 'old-packet', linkId: 'link' }] } });
    await pending;
    expect(vault.deviceId).toBe(device);
    expect(vault.deviceToken).toBe('current-token');
    expect(vault.connectionError).toBe('current-error');
    expect(vault.pendingFetchInProgress).toBe(true);
    expect(vault.realtimeBuffer).toEqual([buffered]);
    expect(incoming).not.toHaveBeenCalled();
    expect(storage.del).not.toHaveBeenCalled();
  });

  it('clears only current in-memory authorization on a current pending-fetch 403', async () => {
    const vault = useVaultStore();
    vault.deviceId = 'enrolled-device';
    vault.deviceToken = 'expired-token';
    vi.spyOn(useAuthStore(), 'fetchCsrfToken').mockResolvedValue(undefined);
    const get = vi.spyOn(api, 'get').mockRejectedValue({ response: { status: 403 } });
    await vault.fetchPendingMessages();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/v1/vault/messages/pending', { params: { deviceId: 'enrolled-device' } });
    expect(vault.deviceId).toBeNull();
    expect(vault.deviceToken).toBeNull();
    expect(vault.pendingFetchInProgress).toBe(false);
    expect(vault.connectionError).toBe('vault_device_not_authorized');
    expect(storage.del).not.toHaveBeenCalled();
  });

  it('authenticates self-sync control ownership as the current account', async () => {
    const vault = setupHistory();
    const control = vi.spyOn(vault, 'handleControlMessage').mockReturnValue(true);
    await vault.ingestSilentSelfMessage('link', { outgoing: true } as never, JSON.stringify({ v: 1, type: 'delete', targetId: 'msg_real' }));
    expect(control).toHaveBeenCalledWith('link', expect.any(String), 'alice');
  });

  it('does not continue initialization after a same-account generation change', async () => {
    const vault = useVaultStore();
    let finish!: () => void;
    vi.spyOn(vault.keyManager, 'init').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const csrf = vi.spyOn(useAuthStore(), 'fetchCsrfToken').mockResolvedValue(undefined);
    const pending = vault.initialize();
    const rejected = expect(pending).rejects.toThrow('superseded');
    useAuthStore().authOperationGeneration++;
    finish();
    await rejected;
    expect(csrf).not.toHaveBeenCalled();
    expect(vault.isInitialized).toBe(false);
  });
});

async function encryptedCheckpointFixture() {
  const actual = await vi.importActual<typeof OfflineVaultModule>('../src/crypto/offlineVault');
  actual.resetOfflineKeyCache();
  const blobs = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  storage.get.mockImplementation(async (key) => structuredClone(blobs.get(key)));
  storage.set.mockImplementation(async (key, value) => { blobs.set(key, structuredClone(value)); });
  storage.del.mockImplementation(async (key) => { blobs.delete(key); });
  storage.keys.mockImplementation(async () => [...blobs.keys()]);
  vi.spyOn(platform, 'isCapacitorRuntime').mockReturnValue(true);
  vi.spyOn(nativeStorage, 'getSecureStorage').mockReturnValue({
    get: async (key: string) => secrets.get(key) ?? null,
    set: async (key: string, value: string) => { secrets.set(key, value); },
  } as never);
  vi.mocked(getEncryptedRatchetState).mockImplementation(actual.getEncryptedRatchetState);
  vi.mocked(setEncryptedRatchetState).mockImplementation(actual.setEncryptedRatchetState);
  const senderKeys = sodium.crypto_kx_keypair();
  const receiverKeys = sodium.crypto_kx_keypair();
  const sender = new CipherEngine();
  const receiver = new CipherEngine();
  await sender.init(senderKeys.privateKey, receiverKeys.publicKey, undefined, undefined, { iAmInitiator: true });
  await receiver.init(receiverKeys.privateKey, senderKeys.publicKey, undefined, undefined, { iAmInitiator: false });
  return { actual, blobs, sender, receiver, senderKeys, receiverKeys, scope: { accountId: 'alice', deviceId: 'alice-device', sessionId: 'link_b' } };
}

async function receiptCrashFixture() {
  const fixture = await encryptedCheckpointFixture();
  const vault = useVaultStore();
  vault.deviceId = fixture.scope.deviceId;
  vault.engines.link_b = fixture.receiver;
  vi.spyOn(vault, 'loadChatSettings').mockResolvedValue({ mode: 'persistent', muted: true });
  vi.spyOn(vault, 'backfillLegacySenderIds').mockResolvedValue(undefined);
  const ack = vi.fn(() => { throw new Error('socket lost before ACK'); });
  const nack = vi.fn();
  vault.transport = { ackMessage: ack, nackMessage: nack } as never;
  const makePacket = async (id: string) => {
    const frame = await fixture.sender.encryptFrame(id);
    return { id, linkId: 'link', senderDeviceId: 'b', ciphertextHex: sodium.to_hex(frame.ciphertext), nonceHex: sodium.to_hex(frame.nonce), senderDHRPubHex: sodium.to_hex(frame.senderDHRPub), messageIndex: frame.messageIndex, pn: frame.PN, createdAt: 123456789 };
  };
  const restart = () => {
    vault.$reset();
    fixture.actual.resetOfflineKeyCache();
    vault.deviceId = fixture.scope.deviceId;
    vi.spyOn(vault.keyManager, 'getStoredKey').mockResolvedValue(fixture.receiverKeys.privateKey);
    ack.mockReset();
    vault.transport = { ackMessage: ack, nackMessage: nack } as never;
  };
  const pub = sodium.to_hex(fixture.senderKeys.publicKey);
  return { ...fixture, vault, ack, nack, makePacket, restart, pub };
}

describe('encrypted receipt checkpoints', () => {
  it('re-ACKs exact redelivery after restart without decrypting, retaining proof across the next receive and an outbound checkpoint', async () => {
    const { vault, actual, scope, receiver, ack, nack, makePacket, restart, pub, blobs } = await receiptCrashFixture();
    const first = await makePacket('first');
    await vault.decryptIncomingPacket('link', first, pub, { senderUserId: 'bob' });
    const second = await makePacket('second');
    await vault.decryptIncomingPacket('link', second, pub, { senderUserId: 'bob' });
    await receiver.encryptFrame('outgoing reply');
    await vault.persistEngineState('link_b');
    const checkpoint = await actual.getEncryptedRatchetState(scope);
    expect(ack).toHaveBeenCalledTimes(2);
    expect(nack).not.toHaveBeenCalled();
    restart();
    const decrypt = vi.spyOn(CipherEngine.prototype, 'decryptFrame');
    await vault.decryptIncomingPacket('link', first, pub, { senderUserId: 'bob' });
    await vault.decryptIncomingPacket('link', second, pub, { senderUserId: 'bob' });
    expect(decrypt).not.toHaveBeenCalled();
    expect(ack.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
    expect(nack).not.toHaveBeenCalled();
    expect(await actual.getEncryptedRatchetState(scope)).toEqual(checkpoint);
    expect(blobs.get('vault_messages_link_uid_alice')).toEqual([
      expect.objectContaining({ id: 'first' }), expect.objectContaining({ id: 'second' }),
    ]);
  });

  it('re-ACKs proven redelivery without requiring history hydration after restart', async () => {
    const { vault, ack, makePacket, restart, pub } = await receiptCrashFixture();
    const packet = await makePacket('first');
    await vault.decryptIncomingPacket('link', packet, pub, { senderUserId: 'bob' });
    restart();
    const hydrate = vi.spyOn(vault, 'loadMessages').mockRejectedValue(new Error('history temporarily unreadable'));
    const decrypt = vi.spyOn(CipherEngine.prototype, 'decryptFrame');
    await vault.decryptIncomingPacket('link', packet, pub, { senderUserId: 'bob' });
    expect(ack).toHaveBeenCalledWith(packet.id);
    expect(hydrate).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it.each(['id', 'ciphertextHex', 'nonceHex', 'senderDHRPubHex', 'messageIndex', 'pn', 'createdAt'])('does not accept an altered packet as durable receipt evidence: %s', async (field) => {
    const { vault, ack, nack, makePacket, restart, pub } = await receiptCrashFixture();
    const first = await makePacket('first');
    await vault.decryptIncomingPacket('link', first, pub, { senderUserId: 'bob' });
    restart();
    const altered = { ...first };
    if (field === 'id') altered.id = 'different-id';
    else if (field === 'messageIndex' || field === 'pn' || field === 'createdAt') altered[field]++;
    else {
      const hexField = field as 'ciphertextHex' | 'nonceHex' | 'senderDHRPubHex';
      altered[hexField] = (first[hexField].startsWith('00') ? '01' : '00') + first[hexField].slice(2);
    }
    await vault.decryptIncomingPacket('link', altered, pub, { senderUserId: 'bob' });
    expect(ack).not.toHaveBeenCalled();
    expect(nack).toHaveBeenCalledWith(altered.id);
  });
  it('does not turn repeated unproven consumed-key redelivery into a poison-message ACK', async () => {
    const { vault, ack, makePacket, restart, pub } = await receiptCrashFixture();
    const packet = await makePacket('first');
    await vault.decryptIncomingPacket('link', packet, pub, { senderUserId: 'bob' });
    restart();
    const altered = { ...packet, id: 'unproven-id' };
    for (let attempt = 0; attempt < 3; attempt++) {
      await vault.decryptIncomingPacket('link', altered, pub, { senderUserId: 'bob' });
    }
    expect(ack).not.toHaveBeenCalled();
  });

  it('keeps recovery-heartbeat checkpoints behind the in-flight receive queue', async () => {
    const { vault, receiver, makePacket, pub } = await receiptCrashFixture();
    const packet = await makePacket('first');
    await vault.decryptIncomingPacket('link', packet, pub, { senderUserId: 'bob' });
    vault.isInitialized = true;
    const send = vi.fn();
    vault.transport = { sendEncryptedPayloadToUser: send } as never;
    let release!: () => void;
    const receiving = new Promise<void>(resolve => { release = resolve; });
    vault.decryptQueueByEngine.set('link_b', receiving);
    const encrypt = vi.spyOn(receiver, 'encryptFrame');
    const heartbeat = vault.sendRecoveryHeartbeat('link', 'bob', [{ id: 'b', devicePub: pub }] as never);
    const waitedForReceive = encrypt.mock.calls.length === 0;
    release();
    await heartbeat;
    expect(waitedForReceive).toBe(true);
    expect(encrypt).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('bounds the receive evidence window without evicting it on outbound checkpoints', async () => {
    const { vault, actual, receiver, scope, makePacket, pub } = await receiptCrashFixture();
    const previous = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(64, '0'));
    await actual.setEncryptedRatchetState(scope, { ...receiver.exportRatchetState(), receivedPacketHashes: previous });
    const packet = await makePacket('newest');
    await vault.decryptIncomingPacket('link', packet, pub, { senderUserId: 'bob' });
    const hashes = (await actual.getEncryptedRatchetState(scope))?.receivedPacketHashes;
    expect(hashes).toHaveLength(256);
    expect(hashes?.slice(0, -1)).toEqual(previous.slice(1));
    await vault.persistEngineState('link_b');
    expect((await actual.getEncryptedRatchetState(scope))?.receivedPacketHashes).toEqual(hashes);
  });

  it('keeps live and durable advanced state aligned when legacy cleanup rejects after receipt commit', async () => {
    const { vault, actual, receiver, scope, makePacket, pub, ack } = await receiptCrashFixture();
    storage.del.mockRejectedValue(new Error('legacy cleanup failed'));
    const initial = receiver.exportRatchetState();
    const packet = await makePacket('committed');
    await vault.decryptIncomingPacket('link', packet, pub, { senderUserId: 'bob' });
    expect(receiver.exportRatchetState()).not.toEqual(initial);
    expect(await actual.getEncryptedRatchetState(scope)).toMatchObject(receiver.exportRatchetState());
    expect(ack).toHaveBeenCalledWith(packet.id);
  });

  it.each([null, 'ab', ['not-a-digest'], Array.from({ length: 257 }, (_, index) => index.toString(16).padStart(64, '0'))])('rejects malformed or oversized receipt evidence: %j', async (evidence) => {
    const { actual, receiver, scope, blobs } = await encryptedCheckpointFixture();
    await actual.setEncryptedRatchetState(scope, receiver.exportRatchetState());
    const original = structuredClone([...blobs.entries()]);
    await expect(actual.setEncryptedRatchetState(scope, { ...receiver.exportRatchetState(), receivedPacketHashes: evidence } as never)).rejects.toThrow('receipt');
    expect([...blobs.entries()]).toEqual(original);
  });

  it('preserves packet evidence through the real encrypted serializer and repeated reads', async () => {
    const { actual, receiver, scope, blobs } = await encryptedCheckpointFixture();
    const checkpoint = { ...receiver.exportRatchetState(), receivedPacketHashes: ['ab'.repeat(32), 'cd'.repeat(32)] };
    await actual.setEncryptedRatchetState(scope, checkpoint);
    expect(await actual.getEncryptedRatchetState(scope)).toEqual(checkpoint);
    actual.resetOfflineKeyCache();
    expect(await actual.getEncryptedRatchetState(scope)).toEqual(checkpoint);
    expect(JSON.stringify([...blobs.values()])).not.toContain('receivedPacketHashes');
    expect(JSON.stringify([...blobs.values()])).not.toContain('ab'.repeat(32));
  });
});

class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  close = vi.fn(() => { this.readyState = 3; });
  constructor() { Socket.instances.push(this); }
}

describe('transport timeout + account cancellation integration', () => {
  it('cancels the old handshake timer so it cannot close the next socket', async () => {
    vi.useFakeTimers();
    Socket.instances = [];
    vi.stubGlobal('WebSocket', Socket);
    const transport = new VaultTransport('device', 'token', async () => ({ token: 'token', proof: 'proof' }));
    const first = transport.connect('mourn.bio', true);
    const cancelled = expect(first).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(0);
    transport.disconnect();
    await cancelled;
    const second = transport.connect('mourn.bio', true);
    await vi.advanceTimersByTimeAsync(0);
    const socket = Socket.instances[1]!;
    socket.readyState = Socket.OPEN;
    socket.onopen?.();
    await second;
    await vi.advanceTimersByTimeAsync(VaultTransport.WS_OPEN_TIMEOUT_MS + 1);
    expect(socket.close).not.toHaveBeenCalled();
    expect(transport.isOpen()).toBe(true);
    transport.disconnect();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import sodium from 'libsodium-wrappers';
import type * as BlobCacheModule from '../src/composables/useBlobAttachmentCache';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() }));
const attachments = vi.hoisted(() => ({ session: vi.fn(), expired: vi.fn() }));
vi.mock('idb-keyval', () => ({ ...storage, update: vi.fn() }));
vi.mock('../src/crypto/offlineVault', () => ({
  getEncryptedRatchetState: vi.fn(), setEncryptedRatchetState: vi.fn(),
  removeEncryptedRatchetStates: vi.fn(), clearOfflineBlobsForUser: vi.fn(),
}));
vi.mock('../src/composables/useBlobAttachmentCache', async (original) => ({
  ...await original<typeof BlobCacheModule>(),
  purgeAttachmentSession: attachments.session, purgeExpiredAttachments: attachments.expired,
}));
import { useAuthStore } from '../src/stores/auth';
import { useVaultStore } from '../src/stores/vault';
import { CipherEngine } from '../src/crypto/engine';
import { setEncryptedRatchetState } from '../src/crypto/offlineVault';

beforeEach(async () => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
  storage.get.mockResolvedValue(undefined);
  storage.set.mockResolvedValue(undefined);
  attachments.session.mockResolvedValue(undefined);
  attachments.expired.mockResolvedValue(undefined);
  vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() });
  await sodium.ready;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const oldMessage = { id: 'old', senderId: 'alice', senderDeviceId: 'a', plaintext: 'previous history', timestamp: 1, isSender: true };
const arrival = { id: 'new', senderId: 'bob', senderDeviceId: 'b', plaintext: 'new arrival', timestamp: 2, isSender: false };

describe('Vault lifecycle persistence boundaries', () => {
  it('retains arrivals in memory after a failed read without replacing unread durable history', async () => {
    const vault = useVaultStore();
    vi.spyOn(vault, 'loadChatSettings').mockResolvedValue(null);
    vi.spyOn(vault, 'backfillLegacySenderIds').mockResolvedValue(undefined);
    storage.get.mockRejectedValue(new Error('transient read failure'));
    await vault.appendMessage('link', arrival);
    expect(vault.messages.link).toEqual([arrival]);
    expect(vault.messageLoadState.link).toBe('error');
    expect(storage.set).not.toHaveBeenCalled();
    await expect(vault.persistMessages('link')).rejects.toThrow('replacement writes blocked');
    expect(storage.set).not.toHaveBeenCalled();
    storage.get.mockResolvedValue([oldMessage]);
    await vault.loadMessages('link');
    expect(vault.messages.link.map(message => message.id)).toEqual(['old', 'new']);
    expect(storage.set).toHaveBeenCalledWith('vault_messages_link_uid_alice', expect.arrayContaining([expect.objectContaining({ id: 'old' }), expect.objectContaining({ id: 'new' })]));
  });

  it('does not normalize malformed durable data into a successful empty replacement', async () => {
    const vault = useVaultStore();
    storage.get.mockResolvedValue({ damaged: true });
    await expect(vault.loadMessages('link')).rejects.toThrow('replacement writes blocked');
    expect(vault.messageLoadState.link).toBe('error');
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('rejects engine creation that resumes after switching accounts', async () => {
    const vault = useVaultStore();
    vault.deviceId = 'alice-device';
    let finish!: (key: Uint8Array) => void;
    const keyRead = vi.spyOn(vault.keyManager, 'getStoredKey').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = vault.getEngine('link', sodium.to_hex(sodium.crypto_kx_keypair().publicKey), undefined, 'bob');
    await vi.waitFor(() => expect(keyRead).toHaveBeenCalled());
    Object.assign(useAuthStore(), { user: { id: 'bob' }, authOperationGeneration: 1 });
    vault.deviceId = 'bob-device';
    finish(sodium.crypto_kx_keypair().privateKey);
    await expect(pending).rejects.toThrow('superseded');
    expect(vault.engines).toEqual({});
    expect(vault.freshEngineBindings).toEqual({});
  });

  it.each(['engine', 'encrypt', 'persist'])('marks the generated outgoing row FAILED_PROTOCOL when preparation fails at %s', async (step) => {
    const vault = useVaultStore();
    vault.deviceId = 'alice-device';
    const send = vi.fn();
    vault.transport = { sendEncryptedPayloadToUser: send } as never;
    vi.spyOn(vault, 'ensureVaultTransport').mockResolvedValue(undefined);
    vi.spyOn(vault, 'loadChatSettings').mockResolvedValue({ mode: 'persistent' });
    vi.spyOn(vault, 'backfillLegacySenderIds').mockResolvedValue(undefined);
    const failure = new Error('preparation failed');
    const encryptFrame = vi.fn().mockResolvedValue({ ciphertext: new Uint8Array(1), nonce: new Uint8Array(1), senderDHRPub: new Uint8Array(32), messageIndex: 0, PN: 0 });
    const engine = vi.spyOn(vault, 'getEngine').mockResolvedValue({ encryptFrame } as never);
    const persist = vi.spyOn(vault, 'persistEngineState').mockResolvedValue(undefined);
    if (step === 'engine') engine.mockRejectedValue(failure);
    if (step === 'encrypt') encryptFrame.mockRejectedValue(failure);
    if (step === 'persist') persist.mockRejectedValue(failure);
    await expect(vault.sendMessage('link', 'bob', [{ id: 'b', devicePub: 'ab' }] as never, 'hello')).rejects.toThrow('preparation failed');
    expect(vault.messages.link).toHaveLength(1);
    expect(vault.messages.link?.[0]?.status).toBe('FAILED_PROTOCOL');
    expect(storage.set).toHaveBeenLastCalledWith('vault_messages_link_uid_alice', [expect.objectContaining({ status: 'FAILED_PROTOCOL' })]);
    expect(send).not.toHaveBeenCalled();
    expect(vault.decryptQueueByEngine.size).toBe(0);
  });

  it.each([true, false])('does not mark a replacement account row failed after obsolete preparation rejects (persistLocal=%s)', async (persistLocal) => {
    const vault = useVaultStore();
    vault.deviceId = 'alice-device';
    const send = vi.fn();
    vault.transport = { sendEncryptedPayloadToUser: send } as never;
    vi.spyOn(vault, 'ensureVaultTransport').mockResolvedValue(undefined);
    vi.spyOn(vault, 'loadChatSettings').mockResolvedValue(null);
    vi.spyOn(vault, 'backfillLegacySenderIds').mockResolvedValue(undefined);
    let fail!: (error: Error) => void;
    const engine = vi.spyOn(vault, 'getEngine').mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    if (!persistLocal) vault.messages.link = [{ ...oldMessage, id: 'same-id', status: 'SENDING' }];
    const pending = vault.sendMessage('link', 'bob', [{ id: 'b', devicePub: 'ab' }] as never, 'hello', { localMessageId: 'same-id', persistLocal });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(engine).toHaveBeenCalled());
    Object.assign(useAuthStore(), { user: { id: 'bob' }, authOperationGeneration: 1 });
    vault.messages.link = [{ ...oldMessage, id: 'same-id', status: 'SENDING' }];
    storage.set.mockClear();
    fail(new Error('old preparation failed'));
    await rejected;
    expect(vault.messages.link[0]?.status).toBe('SENDING');
    expect(storage.set).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['engine', 'encrypt', 'persist'])('marks the captured retry row failed without creating a control row: %s', async (step) => {
    const vault = useVaultStore();
    vault.deviceId = 'alice-device';
    vault.messageLoadState.link = 'ready';
    vault.messages.link = [{ ...oldMessage, status: 'FAILED_PROTOCOL' }];
    const send = vi.fn();
    vault.transport = { sendEncryptedPayloadToUser: send } as never;
    vi.spyOn(vault, 'ensureVaultTransport').mockResolvedValue(undefined);
    vi.spyOn(vault, 'loadChatSettings').mockResolvedValue({ mode: 'persistent' });
    const failure = new Error('retry preparation failed');
    const encryptFrame = vi.fn().mockResolvedValue({ ciphertext: new Uint8Array(1), nonce: new Uint8Array(1), senderDHRPub: new Uint8Array(32), messageIndex: 0, PN: 0 });
    const engine = vi.spyOn(vault, 'getEngine').mockResolvedValue({ encryptFrame } as never);
    const persist = vi.spyOn(vault, 'persistEngineState').mockResolvedValue(undefined);
    if (step === 'engine') engine.mockRejectedValue(failure);
    if (step === 'encrypt') encryptFrame.mockRejectedValue(failure);
    if (step === 'persist') persist.mockRejectedValue(failure);
    await vault.retryMessage('link', 'old');
    expect(vault.messages.link[0]?.status).toBe('SENDING');
    await expect(vault.sendMessage('link', 'bob', [{ id: 'b', devicePub: 'ab' }] as never, 'retry', { persistLocal: false, localMessageId: 'old' })).rejects.toThrow('retry preparation failed');
    expect(vault.messages.link).toHaveLength(1);
    expect(vault.messages.link[0]?.status).toBe('FAILED_PROTOCOL');
    expect(storage.set).toHaveBeenLastCalledWith('vault_messages_link_uid_alice', [expect.objectContaining({ id: 'old', status: 'FAILED_PROTOCOL' })]);
    storage.set.mockClear();
    await expect(vault.sendMessage('link', 'bob', [{ id: 'b', devicePub: 'ab' }] as never, 'control', { persistLocal: false })).rejects.toThrow('retry preparation failed');
    expect(vault.messages.link).toHaveLength(1);
    expect(storage.set).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not roll back a committed checkpoint when legacy cleanup fails', async () => {
    const vault = useVaultStore();
    vault.deviceId = 'alice-device';
    const engine = new CipherEngine();
    await engine.init(sodium.crypto_kx_keypair().privateKey, sodium.crypto_kx_keypair().publicKey);
    vault.engines.link_b = engine;
    const committed = engine.exportRatchetState();
    vi.mocked(setEncryptedRatchetState).mockResolvedValue(undefined);
    storage.del.mockRejectedValueOnce(new Error('legacy cleanup failed'));
    await expect(vault.persistEngineState('link_b')).resolves.toBeUndefined();
    expect(setEncryptedRatchetState).toHaveBeenCalledWith({ accountId: 'alice', deviceId: 'alice-device', sessionId: 'link_b' }, committed);
    expect(engine.exportRatchetState()).toEqual(committed);
  });

  it.each(['unreadable', 'write failure', 'ratchet save failure'])('keeps relay retry decryptable across restart after history %s', async (failure) => {
    const senderKeys = sodium.crypto_kx_keypair();
    const receiverKeys = sodium.crypto_kx_keypair();
    const sender = new CipherEngine();
    const receiver = new CipherEngine();
    await sender.init(senderKeys.privateKey, receiverKeys.publicKey, undefined, undefined, { iAmInitiator: true });
    await receiver.init(receiverKeys.privateKey, senderKeys.publicKey, undefined, undefined, { iAmInitiator: false });
    const initialState = receiver.exportRatchetState();
    let durableState = initialState;
    let restarting = false;
    vi.mocked(setEncryptedRatchetState).mockImplementation(async (_scope, state) => {
      if (failure === 'ratchet save failure' && !restarting) throw new Error('ratchet write failed');
      durableState = structuredClone(state);
    });
    const frame = await sender.encryptFrame('survives restart');
    const packet = { id: 'relay-message', linkId: 'link', senderDeviceId: 'b', ciphertextHex: sodium.to_hex(frame.ciphertext), nonceHex: sodium.to_hex(frame.nonce), senderDHRPubHex: sodium.to_hex(frame.senderDHRPub), messageIndex: frame.messageIndex, pn: frame.PN, createdAt: new Date().toISOString() };
    const durable = new Map<string, unknown>([['vault_messages_link_uid_alice', [oldMessage]]]);
    storage.get.mockImplementation(async (key) => {
      if (failure === 'unreadable') throw new Error('history unreadable');
      return structuredClone(durable.get(key));
    });
    let historyWrites = 0;
    storage.set.mockImplementation(async (key, value) => {
      if (failure === 'write failure' && ++historyWrites > 1) throw new Error('history write failed');
      durable.set(key, structuredClone(value));
    });
    const vault = useVaultStore();
    vault.deviceId = 'alice-device';
    vault.engines.link_b = receiver;
    const ack = vi.fn();
    vault.transport = { ackMessage: ack, nackMessage: vi.fn() } as never;
    vi.spyOn(vault, 'loadChatSettings').mockResolvedValue({ mode: 'persistent', muted: true });
    vi.spyOn(vault, 'backfillLegacySenderIds').mockResolvedValue(undefined);
    vault.attemptedMessageIds.add(packet.id);
    vault.markMessageProcessed(packet.id);
    await vault.decryptIncomingPacket('link', packet, sodium.to_hex(senderKeys.publicKey), { senderUserId: 'bob' });
    expect(ack).not.toHaveBeenCalled();
    expect(durableState).toEqual(initialState);
    expect(receiver.exportRatchetState()).toEqual(initialState);
    expect(vault.attemptedMessageIds.has(packet.id)).toBe(false);
    expect(vault.processedMessageIds[packet.id]).toBeUndefined();

    // Simulate process loss: only durable history and ratchet survive.
    vault.$reset();
    restarting = true;
    const restored = new CipherEngine();
    await restored.importRatchetState(durableState);
    vault.deviceId = 'alice-device';
    vault.engines.link_b = restored;
    vault.transport = { ackMessage: ack, nackMessage: vi.fn() } as never;
    storage.get.mockImplementation(async (key) => structuredClone(durable.get(key)));
    storage.set.mockImplementation(async (key, value) => { durable.set(key, structuredClone(value)); });
    await vault.decryptIncomingPacket('link', packet, sodium.to_hex(senderKeys.publicKey), { senderUserId: 'bob' });
    expect(ack).toHaveBeenCalledWith(packet.id);
    expect(durable.get('vault_messages_link_uid_alice')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'old' }), expect.objectContaining({ id: packet.id, plaintext: 'survives restart' }),
    ]));
    expect(durableState).not.toEqual(initialState);
    expect(vault.messages.link?.filter(message => message.id === packet.id)).toHaveLength(1);
  });

  it('cleans the outgoing session even after auth.user has been cleared', async () => {
    const vault = useVaultStore();
    vault.sessionId = 'session-alice';
    useAuthStore().user = null;
    const sessionStorage = { removeItem: vi.fn() };
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.spyOn(vault, 'syncUnreadBadge').mockResolvedValue(undefined);
    try {
      await vault.clearVaultState('alice');
      expect(attachments.session).toHaveBeenCalledWith('alice', 'session-alice');
      expect(vault.sessionId).toBe('');
    } finally { vi.unstubAllGlobals(); }
  });
});

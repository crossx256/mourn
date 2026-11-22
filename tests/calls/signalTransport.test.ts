import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';
import { CipherEngine } from '../../src/crypto/engine';
import { CallSignalTransport, type CallSignalPort, type IncomingCallSignal } from '../../src/calls/signalTransport';
import type { CallBody } from '../../src/calls/types';
import { callSessionKey, callSessionTranscript } from '../../src/calls/session';
import { createPinia, setActivePinia } from 'pinia';
const local = vi.hoisted(() => ({ rows: new Map<string, unknown>(), ratchets: new Map<string, unknown>() }));
vi.mock('idb-keyval', () => ({ get: async (k: string) => local.rows.get(k), set: async (k: string, v: unknown) => { local.rows.set(k, v); }, del: async (k: string) => { local.rows.delete(k); }, keys: async () => [...local.rows.keys()], update: vi.fn() }));
vi.mock('../../src/crypto/offlineVault', () => ({
  getEncryptedRatchetState: async (scope: unknown) => local.ratchets.get(JSON.stringify(scope)) ?? null,
  setEncryptedRatchetState: async (scope: unknown, value: unknown) => { local.ratchets.set(JSON.stringify(scope), value); },
  readOfflineBlob: async (_k: string, id: string, c: {accountId: string}) => (local.rows.get(JSON.stringify([c.accountId, id])) as Uint8Array | undefined)?.slice(),
  storeOfflineBlob: async (_k: string, id: string, bytes: Uint8Array, _m: unknown, c: {accountId: string}) => { local.rows.set(JSON.stringify([c.accountId, id]), bytes.slice()); },
  removeOfflineBlob: vi.fn(),
  removeEncryptedRatchetStates: vi.fn(), clearOfflineBlobsForUser: vi.fn(),
}));
import { useAuthStore } from '../../src/stores/auth';
import { useVaultStore } from '../../src/stores/vault';
import { api } from '../../src/boot/axios';
import { useLinksStore } from '../../src/stores/links';
import { VaultTransport } from '../../src/crypto/transport';

const aid = '11111111-1111-4111-8111-111111111111';
const bid = '22222222-2222-4222-8222-222222222222';
const cid = '33333333-3333-4333-8333-333333333333';
const linkId = '44444444-4444-4444-8444-444444444444';
const offer = (): CallBody => ({ mc: 1, kind: 'call', t: 'offer', cid, dev: aid, attempt: 1, media: 'audio', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', ts: 123 });
const controllers: CallSignalTransport[] = [];
beforeEach(async () => {
  await sodium.ready; setActivePinia(createPinia()); local.rows.clear(); local.ratchets.clear();
  vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => { controllers.splice(0).forEach(c => c.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function pair() {
  const a = sodium.crypto_kx_keypair(), b = sodium.crypto_kx_keypair();
  const transcript = callSessionTranscript(cid, linkId, { userId: 'alice', deviceId: aid, devicePub: sodium.to_hex(a.publicKey), identityPub: 'aa'.repeat(32) }, { userId: 'bob', deviceId: bid, devicePub: sodium.to_hex(b.publicKey), identityPub: 'bb'.repeat(32) });
  const ae = new CipherEngine(), be = new CipherEngine();
  await ae.init(a.privateKey, b.publicKey, 'alice', 'bob', { iAmInitiator: true }, transcript);
  await be.init(b.privateKey, a.publicKey, 'bob', 'alice', { iAmInitiator: false }, transcript);
  function side(id: string, otherId: string, engine: CipherEngine, pub: Uint8Array) {
    const sent: IncomingCallSignal[] = [];
    const ack = vi.fn();
    const queues = new Map<string, Promise<void>>();
    const port: CallSignalPort = {
      queues: () => queues, deviceId: () => id,
      capture: () => ({ assertCurrent() {}, isCurrent: () => true }),
      ensureConnected: vi.fn(async () => {}),
      resolvePeer: vi.fn(async () => ({ linkId, userId: id === aid ? 'bob' : 'alice', deviceId: otherId, devicePub: sodium.to_hex(pub), identityPub: (id === aid ? 'bb' : 'aa').repeat(32), callId: cid, transcript, iAmInitiator: id === aid })),
      getEngine: async () => engine,
      send: vi.fn(packet => { sent.push({ ...packet, fromUserId: id === aid ? 'alice' : 'bob', fromDeviceId: id, createdAt: packet.createdAt, expiresAt: packet.expiresAt, receiptToken: 'de'.repeat(32) }); }),
      ack,
    };
    const transport = new CallSignalTransport(port); controllers.push(transport); transport.admitCall(cid);
    const unsubscribe = transport.onSignal(() => {});
    return { transport, port, engine, sent, ack, queues, unsubscribe };
  }
  return { a: side(aid, bid, ae, b.publicKey), b: side(bid, aid, be, a.publicKey) };
}

describe('encrypted call signalling', () => {
  it('invalidates a queued signal and retries synchronously when its link is severed', async () => {
    const { a } = await pair();
    const peer = await a.port.resolvePeer(cid, bid);
    let finish!: () => void;
    vi.mocked(a.port.ensureConnected).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = expect(a.transport.send(linkId, 'bob', [{ id: bid }], offer())).rejects.toThrow('SUPERSEDED');
    a.transport.invalidateLink(linkId); finish(); await pending;
    expect(a.engine.exportRatchetState().Ns).toBe(0);
    expect(a.port.send).not.toHaveBeenCalled();
    expect(callSessionKey(peer, aid)).not.toBe(`${linkId}_${bid}`);
  });

  it('cancels exact-byte retry timers on disconnect instead of draining on reconnect', async () => {
    vi.useFakeTimers();
    const { a } = await pair();
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    a.transport.handleDisconnect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a.port.send).toHaveBeenCalledOnce(); expect(a.transport.pendingCount).toBe(0);
  });

  it('preserves recognisable PEER_OFFLINE correlation without retrying its stale offer', async () => {
    vi.useFakeTimers();
    const { a } = await pair(); const errors = vi.fn(); a.transport.onError(errors);
    const [signalId] = await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    a.transport.handleError({ callId: cid, signalId, code: 'PEER_OFFLINE' });
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: 'PEER_OFFLINE', callId: cid, targetDeviceId: bid }));
    await vi.advanceTimersByTimeAsync(10_000); expect(a.port.send).toHaveBeenCalledOnce();
  });

  it('does not ACK before a consumer exists; duplicate retries dispatch only from bounded RAM', async () => {
    const { a, b } = await pair(); b.unsubscribe();
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    await expect(b.transport.receive(a.sent[0]!)).rejects.toThrow('CALL_SIGNAL_CONSUMER_UNAVAILABLE');
    expect(b.ack).not.toHaveBeenCalled();
    const seen = vi.fn(); b.transport.onSignal(seen);
    const decrypt = vi.spyOn(b.engine, 'decryptFrame');
    await b.transport.receive(a.sent[0]!);
    expect(decrypt).not.toHaveBeenCalled(); expect(seen).toHaveBeenCalledOnce(); expect(b.ack).toHaveBeenCalledOnce();
  });

  it('does not dispatch or ACK after cancellation during async decryption', async () => {
    const { a, b } = await pair();
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    const original = b.engine.decryptFrame.bind(b.engine);
    vi.spyOn(b.engine, 'decryptFrame').mockImplementationOnce(async (...args) => {
      const text = await original(...args); b.transport.cancelCall(cid); return text;
    });
    const seen = vi.fn(); b.transport.onSignal(seen);
    await expect(b.transport.receive(a.sent[0]!)).rejects.toThrow('CALL_NOT_ADMITTED');
    expect(seen).not.toHaveBeenCalled(); expect(b.ack).not.toHaveBeenCalled();
  });

  it('keeps call sends and receives entirely in RAM, without persistent callbacks', async () => {
    const { a, b } = await pair();
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    await b.transport.receive(a.sent[0]!);

    expect(local.rows.size).toBe(0); expect(local.ratchets.size).toBe(0);
  });

  it('clears previously scheduled fan-out retries when a later target fails', async () => {
    const { a } = await pair();
    vi.mocked(a.port.resolvePeer).mockRejectedValueOnce(new Error('device unavailable'));
    await expect(a.transport.send(linkId, 'bob', [{ id: bid }, { id: crypto.randomUUID() }], offer())).rejects.toThrow('device unavailable');
    expect(a.transport.pendingCount).toBe(0); expect(a.queues.size).toBe(0);
    vi.mocked(a.port.resolvePeer).mockResolvedValueOnce(await a.port.resolvePeer(cid, bid, 'bob')).mockRejectedValueOnce(new Error('second device unavailable'));
    await expect(a.transport.send(linkId, 'bob', [{ id: bid }, { id: crypto.randomUUID() }], offer())).rejects.toThrow('second device unavailable');
    expect(a.transport.pendingCount).toBe(0); expect(a.queues.size).toBe(0);
  });

  it('stops stale sends if the Vault device changes while waiting for the engine', async () => {
    const { a } = await pair();
    Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
    const vault = useVaultStore(); vault.deviceId = aid;
    const send = vi.fn(); vault.transport = { sendCallSignal: send, isOpen: () => true } as never;
    vi.spyOn(vault, 'ensureVaultTransport').mockResolvedValue(undefined);
    vi.spyOn(vault, 'resolveCallSignalPeer').mockResolvedValue(await a.port.resolvePeer(cid, bid, 'bob'));
    let finish!: (engine: CipherEngine) => void;
    const getting = vi.spyOn(vault, 'getCallEngine').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = vault.getCallSignalTransport(); controllers.push(controller); controller.admitCall(cid);
    const pending = expect(vault.sendCallSignal(linkId, 'bob', [{ id: bid }], offer())).rejects.toThrow('SUPERSEDED');
    await vi.waitFor(() => expect(getting).toHaveBeenCalled());
    vault.deviceId = crypto.randomUUID(); finish(a.engine);
    await pending;
    expect(send).not.toHaveBeenCalled(); expect(a.engine.exportRatchetState().Ns).toBe(0);
    expect(vault.decryptQueueByEngine.size).toBe(0); expect(local.ratchets.size).toBe(0);
  });

  it('never renders call plaintext relabelled into the chat frame domain', async () => {
    const { a, b } = await pair();
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    Object.assign(useAuthStore(), { user: { id: 'bob' }, isLoggedIn: true });
    const vault = useVaultStore(); vault.deviceId = bid;
    const chatPeer = sodium.crypto_kx_keypair(), chatLocal = sodium.crypto_kx_keypair();
    const chat = new CipherEngine(); await chat.init(chatLocal.privateKey, chatPeer.publicKey, 'bob', 'alice', { iAmInitiator: false });
    vault.engines[`${linkId}_${aid}`] = chat;
    vault.messageLoadState[linkId] = 'ready';
    const append = vi.spyOn(vault, 'appendMessage');
    const persist = vi.spyOn(vault, 'persistMessages').mockResolvedValue(undefined);
    const unread = vi.spyOn(vault, 'markLinkUnread');
    const ack = vi.fn(); vault.transport = { ackMessage: ack } as never;
    const signal = a.sent[0]!;
    await vault.decryptIncomingPacket(linkId, { ...signal, id: 'chat-relay-id', senderDeviceId: aid }, sodium.to_hex(sodium.crypto_kx_keypair().publicKey), { senderUserId: 'alice' });
    expect(append).not.toHaveBeenCalled(); expect(unread).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled(); expect(ack).not.toHaveBeenCalled();
  });

  it('resolves call devices against fresh link metadata and enforces existing identity pins', async () => {
    Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
    const vault = useVaultStore(); vault.deviceId = aid;
    const pub = sodium.to_hex(sodium.crypto_kx_keypair().publicKey);
    const identity = 'ab'.repeat(32);
    vi.spyOn(vault.keyManager, 'getStoredKey').mockResolvedValue(sodium.crypto_kx_keypair().privateKey);
    vi.spyOn(api, 'get').mockResolvedValue({ data: { call: { id: cid, linkId, callerId: 'alice', calleeId: 'bob', callerDeviceId: aid, answeredDeviceId: bid, media: 'audio', protocolVersion: 1, state: 'RINGING', createdAt: new Date().toISOString() } } });
    const links = useLinksStore();
    links.links = [{ id: linkId, status: 'ESTABLISHED', senderId: 'alice', receiverId: 'bob', sender: { devices: [] }, receiver: { devices: [{ id: bid, devicePub: pub, identityPub: identity }] } }] as never;
    vi.spyOn(links, 'fetchLinks').mockResolvedValue(undefined);
    expect(await vault.resolveCallSignalPeer(cid, bid, 'bob')).toMatchObject({ linkId, deviceId: bid, devicePub: pub, userId: 'bob', identityPub: identity, callId: cid, iAmInitiator: true });
    expect(await vault.getTrustedDeviceIdentity(linkId, bid)).toBe(identity);
    await expect(vault.resolveCallSignalPeer(cid, aid, 'bob')).rejects.toThrow('CALL_DEVICE_MISMATCH');
    await expect(vault.resolveCallSignalPeer(cid, bid, 'mallory')).rejects.toThrow('CALL_PEER_MISMATCH');
    vault.trustedDeviceIdentities[linkId]![bid] = 'cd'.repeat(32);
    await expect(vault.resolveCallSignalPeer(cid, bid, 'bob')).rejects.toThrow('LINK_COMPROMISED');
    expect(vault.messages).toEqual({});
  });

  it('rejects reuse of a signalId for different authenticated ciphertext without consuming it', async () => {
    const { a, b } = await pair();
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    await b.transport.receive(a.sent[0]!);
    await expect(b.transport.receive({ ...a.sent[1]!, signalId: a.sent[0]!.signalId })).rejects.toThrow('CALL_SIGNAL_CONFLICT');
    expect(b.ack).toHaveBeenCalledOnce();
    await b.transport.receive(a.sent[1]!); expect(b.ack).toHaveBeenCalledTimes(2);
  });

  it('dedupes simultaneous packets only within the admitted live RAM session', async () => {
    const { a, b } = await pair();
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    const packet = a.sent[0]!; const seen = vi.fn(); b.transport.onSignal(seen);
    await Promise.all([b.transport.receive(packet), b.transport.receive(packet)]);
    expect(seen).toHaveBeenCalledOnce(); expect(b.ack).toHaveBeenCalledTimes(2);
    b.transport.cancelCall(cid);
    await expect(b.transport.receive(packet)).rejects.toThrow('CALL_NOT_ADMITTED');
    expect(() => b.transport.admitCall(cid)).toThrow('CALL_SESSION_RETIRED');
    const restarted = new CallSignalTransport(b.port); controllers.push(restarted);
    await expect(restarted.receive(packet)).rejects.toThrow('CALL_NOT_ADMITTED');
    expect(seen).toHaveBeenCalledOnce();
  });

  it.each(['callId', 'signalId', 'kind', 'attempt', 'needsOffer', 'fromUserId', 'fromDeviceId', 'messageIndex', 'pn', 'ciphertextHex', 'createdAt', 'expiresAt'] as const)('rejects tampered %s without ACK/dispatch or permanent key consumption', async field => {
    const { a, b } = await pair();
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    const seen = vi.fn(); b.transport.onSignal(seen);
    const packet = a.sent[0]!;
    const changes = { createdAt: new Date(Date.parse(packet.createdAt) + 1000).toISOString(), expiresAt: new Date(Date.parse(packet.expiresAt) - 1000).toISOString(), signalId: crypto.randomUUID(), callId: crypto.randomUUID(), kind: 'answer', attempt: 2, needsOffer: true, fromUserId: 'mallory', fromDeviceId: crypto.randomUUID(), messageIndex: 1, pn: 1, ciphertextHex: 'ab'.repeat(packet.ciphertextHex.length / 2) };
    const before = b.engine.exportRatchetState();
    await expect(b.transport.receive({ ...packet, [field]: changes[field] })).rejects.toThrow();
    expect(b.engine.exportRatchetState()).toEqual(before);
    expect(b.ack).not.toHaveBeenCalled(); expect(seen).not.toHaveBeenCalled(); expect(b.queues.size).toBe(0);
    await b.transport.receive(packet); expect(seen).toHaveBeenCalledOnce();
  });

  it('derives createdAt and expiresAt from one clock sample', async () => {
    vi.useFakeTimers();
    const { a, b } = await pair();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 1);
    try {
      await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
      const packet = a.sent[0]!;
      expect(Date.parse(packet.expiresAt) - Date.parse(packet.createdAt)).toBe(10_000);
      await expect(b.transport.receive(packet)).resolves.toBeUndefined();
    } finally { clock.mockRestore(); }
  });

  it('rejects offline before consuming a ratchet index without reconnect or queue', async () => {
    const { a } = await pair();
    vi.mocked(a.port.ensureConnected).mockRejectedValueOnce(new Error('CALL_OFFLINE'));
    await expect(a.transport.send(linkId, 'bob', [{ id: bid }], offer())).rejects.toThrow('CALL_OFFLINE');
    expect(a.engine.exportRatchetState().Ns).toBe(0); expect(a.port.send).not.toHaveBeenCalled();
    expect(a.transport.pendingCount).toBe(0); expect(a.queues.size).toBe(0);
  });

  it('does not retry or ACK ICE and expires RAM retries after exactly three sends', async () => {
    vi.useFakeTimers();
    const { a, b } = await pair();
    await a.transport.send(linkId, 'bob', [{ id: bid }], { mc: 1, kind: 'call', t: 'ice-end', cid, dev: aid, attempt: 1 });
    await b.transport.receive(a.sent[0]!);
    expect(b.ack).not.toHaveBeenCalled(); expect(a.transport.pendingCount).toBe(0);
    const error = vi.fn(); a.transport.onError(error);
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a.port.send).toHaveBeenCalledTimes(4); expect(a.transport.pendingCount).toBe(0);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'CALL_SIGNAL_ACK_TIMEOUT' }));
  });

  it('does not dispatch expired offers even if a relay redelivers them', async () => {
    const { a, b } = await pair();
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    const seen = vi.fn(); b.transport.onSignal(seen);
    await b.transport.receive({ ...a.sent[0]!, expiresAt: new Date(Date.now() - 1).toISOString() });
    expect(seen).not.toHaveBeenCalled();
  });

  it('uses separate Vault call engine, storage and queue namespaces without advancing chat', async () => {
    const { a } = await pair();
    Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
    const vault = useVaultStore(); vault.deviceId = aid; vault.isInitialized = true;
    const chatKey = `${linkId}_${bid}`;
    const chatKeys = sodium.crypto_kx_keypair(), peerKeys = sodium.crypto_kx_keypair();
    const chat = new CipherEngine(); await chat.init(chatKeys.privateKey, peerKeys.publicKey, 'alice', 'bob');
    vault.engines[chatKey] = chat;
    const before = chat.exportRatchetState();
    const peer = await a.port.resolvePeer(cid, bid, 'bob');
    vi.spyOn(vault.keyManager, 'getStoredKey').mockResolvedValue(chatKeys.privateKey);
    vault.transport = { sendCallSignal: vi.fn(), isOpen: () => true } as never;
    vi.spyOn(vault, 'ensureVaultTransport').mockResolvedValue(undefined);
    vi.spyOn(vault, 'resolveCallSignalPeer').mockResolvedValue(peer);
    const controller = vault.getCallSignalTransport(); controllers.push(controller); controller.admitCall(cid);
    const ring = { id: cid, linkId, callerId: 'alice', calleeId: 'bob', callerDeviceId: aid, answeredDeviceId: null,
      state: 'RINGING', media: 'audio', protocolVersion: 1, createdAt: new Date().toISOString(),
      ringExpiresAt: new Date(Date.now() + 60_000).toISOString(), answeredAt: null, endedAt: null,
      endReason: null, relayed: null, qualityBucket: null } as const;
    vi.spyOn(api, 'get').mockResolvedValue({ data: { call: ring } });
    await vault.admitCallSignals(cid, ring);
    await vault.sendCallSignal(linkId, 'bob', [{ id: bid }], offer());
    expect(chat.exportRatchetState()).toEqual(before);
    const key = callSessionKey(peer, aid);
    expect(vault.engines[key]).toBeUndefined();
    expect((await vault.getCallEngine(peer, key)).exportRatchetState().Ns).toBe(1);
    expect(vault.decryptQueueByEngine.size).toBe(0);
    expect(local.ratchets.size).toBe(0);
    expect(vault.messages).toEqual({});
    expect(local.rows.size).toBe(0);
  });

  it('dispatches all call socket events independently from chat', async () => {
    let socket!: FakeSocket;
    class FakeSocket {
      static OPEN = 1; static CONNECTING = 0;
      readyState = 0;
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      constructor() { socket = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
      close() { this.readyState = 3; }
      send() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    const transport = new VaultTransport(aid, 'test-token', async () => ({ token: 'test-token', proof: 'test-proof' }));
    const chat = vi.fn(); transport.onMessage = chat;
    const handlers = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    [transport.onCallSignal, transport.onCallSignalAck, transport.onCallSignalStored, transport.onCallSignalError, transport.onCallIncoming, transport.onCallState, transport.onCallReady] = handlers;
    await transport.connect('localhost');
    for (const type of ['CALL_SIGNAL', 'CALL_SIGNAL_ACK', 'CALL_SIGNAL_STORED', 'CALL_SIGNAL_ERROR', 'CALL_INCOMING', 'CALL_STATE', 'CALL_READY']) socket.onmessage?.({ data: JSON.stringify({ type, callId: cid }) });
    expect(handlers.every(handler => handler.mock.calls.length === 1)).toBe(true);
    expect(chat).not.toHaveBeenCalled(); transport.disconnect();
  });

  it('routes encrypted CALL_SIGNAL and ACK packets without the plaintext RTC_SIGNAL path', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const ws = { readyState: 1, send: vi.fn() };
    const transport = new VaultTransport(aid, 'not-a-real-token', async () => ({ token: '', proof: '' }));
    Object.assign(transport, { ws });
    const packet = { callId: cid, signalId: crypto.randomUUID(), targetDeviceId: bid, kind: 'offer' as const, attempt: 1, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10000).toISOString(), ciphertextHex: 'ab', nonceHex: 'ab'.repeat(24), senderDHRPubHex: 'ab'.repeat(32), messageIndex: 0, pn: 0 };
    const receiptToken = 'de'.repeat(32);
    transport.sendCallSignal(packet); transport.ackCallSignal(cid, packet.signalId, receiptToken);
    expect(JSON.parse(ws.send.mock.calls[0]![0])).toEqual({ type: 'CALL_SIGNAL', ...packet });
    expect(JSON.parse(ws.send.mock.calls[1]![0])).toEqual({ type: 'CALL_SIGNAL_ACK', callId: cid, signalId: packet.signalId, receiptToken });
  });

  it('releases terminal keys and retry data after bounded ACK grace without readmission', async () => {
    vi.useFakeTimers();
    const { a } = await pair();
    const release = vi.fn(); a.port.releaseCall = release;
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    a.transport.retireCall(cid);
    a.transport.retireCall(cid);
    await vi.advanceTimersByTimeAsync(9999);
    expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(release).toHaveBeenCalledExactlyOnceWith(cid);
    expect(a.transport.pendingCount).toBe(0);
    expect(() => a.transport.assertAdmitted(cid)).toThrow('CALL_NOT_ADMITTED');
    expect(() => a.transport.admitCall(cid)).toThrow('CALL_SESSION_RETIRED');
  });

  it('replays ciphertext at 2s/6s, ignores storage ACK, stops only for the matching peer ACK', async () => {
    vi.useFakeTimers();
    const { a } = await pair();
    const [id] = await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    a.transport.handleStored({ callId: cid, signalId: id, stored: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.port.send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(a.port.send).mock.calls[0]).toEqual(vi.mocked(a.port.send).mock.calls[1]);
    a.transport.handleAck({ callId: cid, signalId: id, fromDeviceId: aid, accepted: true });
    await vi.advanceTimersByTimeAsync(4000);
    expect(a.port.send).toHaveBeenCalledTimes(3);
    a.transport.handleAck({ callId: cid, signalId: id, fromDeviceId: bid, accepted: true });
    expect(a.transport.pendingCount).toBe(0);
    expect(a.engine.exportRatchetState().Ns).toBe(1);
    expect(vi.getTimerCount()).toBe(4);
  });

  it('cleans retries on server rejection, socket-send error and disposal', async () => {
    vi.useFakeTimers();
    const { a, b } = await pair();
    const errors = vi.fn(); a.transport.onError(errors);
    const [id] = await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    a.transport.handleError({ callId: cid, signalId: id, code: 'CALL_ENDED' });
    expect(a.transport.pendingCount).toBe(0);
    expect(errors).toHaveBeenCalledOnce();
    vi.mocked(a.port.send).mockImplementationOnce(() => { throw new Error('socket closed'); });
    await expect(a.transport.send(linkId, 'bob', [{ id: bid }], offer())).rejects.toThrow('socket closed');
    expect(a.transport.pendingCount).toBe(0);
    await a.transport.send(linkId, 'bob', [{ id: bid }], offer());
    a.transport.dispose(); b.transport.dispose();
    expect(a.transport.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('round trips authenticated offer/answer using the existing ratchet and validates before ACK', async () => {
    const { a, b } = await pair();
    const received = vi.fn(); b.transport.onSignal(received);
    const ids = await a.transport.send(linkId, 'bob', [{ id: bid, devicePub: 'not trusted input' }], offer());
    expect(a.sent[0]?.ciphertextHex).not.toContain('v=0');
    expect(a.sent[0]).not.toHaveProperty('sdp');
    await b.transport.receive(a.sent[0]!);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ body: offer(), linkId, fromUserId: 'alice' }));

    expect(b.ack).toHaveBeenCalledWith(cid, ids[0], a.sent[0]!.receiptToken);
    const answer: CallBody = { mc: 1, kind: 'call', cid, dev: bid, attempt: 1, t: 'answer', needsOffer: true, ts: Date.now() };
    const ar = vi.fn(); a.transport.onSignal(ar);
    await b.transport.send(linkId, 'alice', [{ id: aid, devicePub: '' }], answer);
    await a.transport.receive(b.sent[0]!);
    expect(ar).toHaveBeenCalledWith(expect.objectContaining({ body: answer }));
    expect(a.queues.size + b.queues.size).toBe(0);
  });
});

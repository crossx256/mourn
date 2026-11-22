import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';
import { createPinia, setActivePinia } from 'pinia';
const disk = vi.hoisted(() => ({ access: vi.fn(() => { throw new Error('call storage forbidden'); }) }));
vi.mock('idb-keyval', () => ({ get: disk.access, set: disk.access, del: disk.access, keys: disk.access, update: disk.access }));
vi.mock('../../src/crypto/offlineVault', () => ({ readOfflineBlob: disk.access, storeOfflineBlob: disk.access, removeOfflineBlob: disk.access, getEncryptedRatchetState: disk.access, setEncryptedRatchetState: disk.access, removeEncryptedRatchetStates: disk.access, clearOfflineBlobsForUser: disk.access }));
import { useVaultStore } from '../../src/stores/vault';
import { useAuthStore } from '../../src/stores/auth';
import { api } from '../../src/boot/axios';
import { CipherEngine } from '../../src/crypto/engine';
import { CallSignalTransport, type CallSignalPort, type IncomingCallSignal } from '../../src/calls/signalTransport';
import { callSessionKey, callSessionTranscript } from '../../src/calls/session';
import type { ServerCall } from '../../src/calls/types';
const aid = '11111111-1111-4111-8111-111111111111', bid = '22222222-2222-4222-8222-222222222222';
const cid = '33333333-3333-4333-8333-333333333333', linkId = '44444444-4444-4444-8444-444444444444';
const createdRing = (): ServerCall => ({
  id: cid, linkId, callerId: 'alice', calleeId: 'bob', callerDeviceId: aid, answeredDeviceId: null,
  media: 'audio', state: 'RINGING', protocolVersion: 1, createdAt: new Date().toISOString(),
  ringExpiresAt: new Date(Date.now() + 60_000).toISOString(), answeredAt: null, endedAt: null,
  endReason: null, relayed: null, qualityBucket: null,
});
const controllers: CallSignalTransport[] = [];
beforeEach(async () => { await sodium.ready; setActivePinia(createPinia()); disk.access.mockClear(); });
afterEach(() => { controllers.splice(0).forEach(c => c.dispose()); vi.restoreAllMocks(); vi.useRealTimers(); });
async function fixture() {
  const a = sodium.crypto_kx_keypair(), b = sodium.crypto_kx_keypair();
  const transcript = callSessionTranscript(cid, linkId,
    { userId: 'alice', deviceId: aid, devicePub: sodium.to_hex(a.publicKey), identityPub: 'aa'.repeat(32) },
    { userId: 'bob', deviceId: bid, devicePub: sodium.to_hex(b.publicKey), identityPub: 'bb'.repeat(32) });
  Object.assign(useAuthStore(), { user: { id: 'bob' }, isLoggedIn: true });
  const vault = useVaultStore(); vault.deviceId = bid;
  const peer = { callId: cid, linkId, userId: 'alice', deviceId: aid, devicePub: sodium.to_hex(a.publicKey), identityPub: 'aa'.repeat(32), transcript, iAmInitiator: false };
  vi.spyOn(vault.keyManager, 'getStoredKey').mockResolvedValue(b.privateKey);
  vi.spyOn(vault, 'resolveCallSignalPeer').mockResolvedValue(peer);
  vi.spyOn(api, 'get').mockResolvedValue({ data: { call: createdRing() } });
  const ack = vi.fn(), sentBack = vi.fn();
  vault.transport = { isOpen: () => true, sendCallSignal: sentBack, ackCallSignal: ack } as never;
  const receiver = vault.getCallSignalTransport(); controllers.push(receiver);
  await vault.admitCallSignals(cid);
  const engine = new CipherEngine(); await engine.init(a.privateKey, b.publicKey, 'alice', 'bob', { iAmInitiator: true }, transcript);
  const packets: IncomingCallSignal[] = [];
  const queues = new Map<string, Promise<void>>();
  const port: CallSignalPort = {
    queues: () => queues, deviceId: () => aid, capture: () => ({ assertCurrent() {}, isCurrent: () => true }), ensureConnected: async () => {},
    resolvePeer: async () => ({ ...peer, userId: 'bob', deviceId: bid, devicePub: sodium.to_hex(b.publicKey), identityPub: 'bb'.repeat(32), iAmInitiator: true }),
    getEngine: async () => engine,
    send: packet => { packets.push({ ...packet, fromUserId: 'alice', fromDeviceId: aid, receiptToken: 'de'.repeat(32) }); }, ack() {},
  };
  const sender = new CallSignalTransport(port); controllers.push(sender); sender.admitCall(cid);
  return { sender, receiver, vault, peer, packets, ack, sentBack };
}
describe('memory-only signalling (replaces the disk journal)', () => {
  it('never invokes idb or offlineVault on real Vault call send/receive paths', async () => {
    const f = await fixture();
    await f.sender.send(linkId, 'bob', [{ id: bid }], { mc: 1, kind: 'call', t: 'offer', cid, dev: aid, attempt: 1, media: 'audio', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', ts: Date.now() });
    const seen = vi.fn(); f.receiver.onSignal(seen); await f.receiver.receive(f.packets[0]!);
    await f.vault.sendCallSignal(linkId, 'alice', [{ id: aid }], { mc: 1, kind: 'call', t: 'answer', cid, dev: bid, attempt: 1, needsOffer: true, ts: Date.now() });
    expect(seen).toHaveBeenCalledOnce(); expect(f.ack).toHaveBeenCalledOnce(); expect(f.sentBack).toHaveBeenCalledOnce();
    expect(disk.access).not.toHaveBeenCalled();
    expect(f.vault.engines).toEqual({});
  });
  it('cannot recreate a used responder chain after call disposal, even through direct engine access', async () => {
    const f = await fixture(), key = callSessionKey(f.peer, bid);
    await f.vault.getCallEngine(f.peer, key); f.receiver.cancelCall(cid);
    await expect(f.vault.getCallEngine(f.peer, key)).rejects.toThrow('CALL_NOT_ADMITTED');
    expect(() => f.receiver.admitCall(cid)).toThrow('CALL_SESSION_RETIRED');
    expect(disk.access).not.toHaveBeenCalled();
  });
  it('requires explicit fresh RINGING admission and refuses ACTIVE restart reconstruction', async () => {
    const f = await fixture();
    const other = crypto.randomUUID();
    vi.mocked(api.get).mockResolvedValue({ data: { call: { id: other, state: 'ACTIVE', createdAt: new Date().toISOString() } } });
    await expect(f.vault.admitCallSignals(other)).rejects.toThrow('CALL_FRESH_RING_REQUIRED');
  });
  it('admits from this device’s successful create response even when the first live lookup is ACTIVE', async () => {
    const created = createdRing();
    Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
    const vault = useVaultStore(); vault.deviceId = aid;
    const local = sodium.crypto_kx_keypair(), remote = sodium.crypto_kx_keypair();
    const initiator = { userId: 'alice', deviceId: aid, devicePub: sodium.to_hex(local.publicKey), identityPub: 'aa'.repeat(32) };
    const responder = { userId: 'bob', deviceId: bid, devicePub: sodium.to_hex(remote.publicKey), identityPub: 'bb'.repeat(32) };
    const peer = { ...responder, callId: cid, linkId, iAmInitiator: true, transcript: callSessionTranscript(cid, linkId, initiator, responder) };
    const lookup = vi.spyOn(api, 'get').mockResolvedValue({ data: { call: { ...created, state: 'ACTIVE', answeredDeviceId: bid } } });
    vi.spyOn(vault.keyManager, 'getStoredKey').mockResolvedValue(local.privateKey);
    const controller = vault.getCallSignalTransport(); controllers.push(controller);
    await vault.admitCallSignals(cid, created);
    expect(lookup).not.toHaveBeenCalled();
    await expect(vault.getCallEngine(peer, callSessionKey(peer, aid))).resolves.toBeInstanceOf(CipherEngine);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(`/api/v1/calls/${cid}`);
    expect(disk.access).not.toHaveBeenCalled();
  });
  it.each([
    { state: 'ACTIVE', answeredDeviceId: bid },
    { callerDeviceId: bid },
    { callerId: 'other' },
    { id: linkId },
    { createdAt: 'not a date' },
    { createdAt: '2000-01-01T00:00:00.000Z' },
  ])('does not admit invalid outgoing proof: %j', async patch => {
    Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
    const vault = useVaultStore(); vault.deviceId = aid;
    const controller = vault.getCallSignalTransport(); controllers.push(controller);
    await expect(vault.admitCallSignals(cid, { ...createdRing(), ...patch } as ServerCall)).rejects.toThrow('CALL_FRESH_RING_REQUIRED');
    expect(() => controller.assertAdmitted(cid)).toThrow('CALL_NOT_ADMITTED');
  });
  it('allows first responder use after its fresh RINGING admission wins the REST answer claim', async () => {
    const f = await fixture();
    vi.mocked(api.get).mockResolvedValue({ data: { call: { id: cid, state: 'ACTIVE', createdAt: new Date().toISOString() } } });
    const engine = await f.vault.getCallEngine(f.peer, callSessionKey(f.peer, bid));
    expect(engine.exportRatchetState().Ns).toBe(0);
    expect(disk.access).not.toHaveBeenCalled();
  });
  it('has no disk journal, offline outbox or reconnect drain API', async () => {
    const { receiver } = await fixture();
    for (const name of ['replayJournal', 'replayOutbox', 'drain']) expect(receiver).not.toHaveProperty(name);
  });
  it('rejects a disconnected Vault without trying to reconnect', async () => {
    const f = await fixture();
    f.vault.transport = { isOpen: () => false } as never;
    const reconnect = vi.spyOn(f.vault, 'ensureVaultTransport');
    await expect(f.vault.sendCallSignal(linkId, 'alice', [{ id: aid }], { mc: 1, kind: 'call', t: 'ice-end', cid, dev: bid, attempt: 1 })).rejects.toThrow('CALL_OFFLINE');
    expect(reconnect).not.toHaveBeenCalled(); expect(disk.access).not.toHaveBeenCalled();
  });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';
import { CipherEngine } from '../../src/crypto/engine';
import { DoubleRatchet } from '../../src/crypto/ratchet';
import { callSessionTranscript } from '../../src/calls/session';
beforeAll(async () => { await sodium.ready; });
describe('call cryptographic domain separation', () => {
  it('separates even the deterministic responder pre-init chain from chat and other calls', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = sodium.crypto_kx_keypair(), b = sodium.crypto_kx_keypair();
    const receiver = async (context?: string) => { const e = new CipherEngine(); await e.init(b.privateKey, a.publicKey, 'b', 'a', { iAmInitiator: false }, context); return e; };
    const chat = await receiver(), call = await receiver('call-one'), other = await receiver('call-two');
    expect(call.exportRatchetState().CKs_hex).not.toBe(chat.exportRatchetState().CKs_hex);
    expect(call.exportRatchetState().CKs_hex).not.toBe(other.exportRatchetState().CKs_hex);
    const sender = new CipherEngine(); await sender.init(a.privateKey, b.publicKey, 'a', 'b', { iAmInitiator: true }, 'call-one');
    const packet = await call.encryptFrame('pre-init answer');
    expect(await sender.decryptFrame(packet)).toBe('pre-init answer');
    const wrong = new CipherEngine(); await wrong.init(a.privateKey, b.publicKey, 'a', 'b', { iAmInitiator: true }, 'call-two');
    await expect(wrong.decryptFrame(packet)).rejects.toThrow();
    vi.restoreAllMocks();
  });
  it('preserves legacy chat pre-init key derivation exactly', async () => {
    const a = sodium.crypto_kx_keypair(), b = sodium.crypto_kx_keypair();
    const legacy = new CipherEngine();
    await legacy.init(b.privateKey, a.publicKey, 'b', 'a', { iAmInitiator: false });
    const dh = sodium.crypto_scalarmult(b.privateKey, a.publicKey);
    expect(legacy.exportRatchetState().CKs_hex).toBe(sodium.to_hex(DoubleRatchet.preInitChain(dh)));
  });
  it.each(['call', 'link', 'caller-user', 'callee-user', 'caller-device', 'callee-device', 'caller-pub', 'callee-pub', 'caller-identity', 'callee-identity', 'protocol'] as const)('cryptographically binds transcript %s', async field => {
    const a = sodium.crypto_kx_keypair(), b = sodium.crypto_kx_keypair();
    const caller = { userId: 'alice', deviceId: '11111111-1111-4111-8111-111111111111', devicePub: sodium.to_hex(a.publicKey), identityPub: 'aa'.repeat(32) };
    const callee = { userId: 'bob', deviceId: '22222222-2222-4222-8222-222222222222', devicePub: sodium.to_hex(b.publicKey), identityPub: 'bb'.repeat(32) };
    let call = '33333333-3333-4333-8333-333333333333', link = '44444444-4444-4444-8444-444444444444';
    const original = callSessionTranscript(call, link, caller, callee);
    if (field === 'call') call = crypto.randomUUID();
    else if (field === 'link') link = crypto.randomUUID();
    else if (field !== 'protocol') {
      const [side, attr] = field.split('-');
      const endpoint = side === 'caller' ? caller : callee;
      if (attr === 'user') endpoint.userId += '-other';
      if (attr === 'device') endpoint.deviceId = crypto.randomUUID();
      if (attr === 'pub') endpoint.devicePub = 'cc'.repeat(32);
      if (attr === 'identity') endpoint.identityPub = 'dd'.repeat(32);
    }
    let changed = callSessionTranscript(call, link, caller, callee);
    if (field === 'protocol') changed = changed.replace('mourn/call-session/v1', 'mourn/not-calls/v1');
    const engine = async (context: string) => { const e = new CipherEngine(); await e.init(b.privateKey, a.publicKey, 'bob', 'alice', { iAmInitiator: false }, context); return e; };
    expect((await engine(original)).exportRatchetState().CKs_hex).not.toBe((await engine(changed)).exportRatchetState().CKs_hex);
  });

  it('loses more than 1000 call frames without consuming any queued chat keys', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = sodium.crypto_kx_keypair(), b = sodium.crypto_kx_keypair();
    const makePair = async (context?: string) => {
      const left = new CipherEngine(), right = new CipherEngine();
      await left.init(a.privateKey, b.publicKey, 'alice', 'bob', { iAmInitiator: true }, context);
      await right.init(b.privateKey, a.publicKey, 'bob', 'alice', { iAmInitiator: false }, context);
      return [left, right] as const;
    };
    const [chatA, chatB] = await makePair();
    const queued = await chatA.encryptFrame('durable chat predating ICE loss');
    const beforeA = chatA.exportRatchetState(), beforeB = chatB.exportRatchetState();
    const [callA, callB] = await makePair('call-loss-test');
    for (let i = 0; i < 1001; i++) await callA.encryptFrame('dropped ICE');
    const tooFar = await callA.encryptFrame('unrecoverable call');
    await expect(callB.decryptFrame(tooFar)).rejects.toThrow('Too many skipped');
    expect(chatA.exportRatchetState()).toEqual(beforeA); expect(chatB.exportRatchetState()).toEqual(beforeB);
    expect(await chatB.decryptFrame(queued)).toBe('durable chat predating ICE loss');
    expect(await chatA.decryptFrame(await chatB.encryptFrame('chat reply'))).toBe('chat reply');
    // A new call has fresh KDF material even with the same registered devices.
    const [nextA, nextB] = await makePair('new-call-after-loss');
    expect(await nextB.decryptFrame(await nextA.encryptFrame('fresh offer'))).toBe('fresh offer');
    vi.restoreAllMocks();
  });

  it('fails closed for a receiver missing entire DH epochs while independent chat survives', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = sodium.crypto_kx_keypair(), b = sodium.crypto_kx_keypair();
    const ca = new CipherEngine(), cb = new CipherEngine(), chatA = new CipherEngine(), chatB = new CipherEngine();
    await ca.init(a.privateKey, b.publicKey, 'a', 'b', { iAmInitiator: true }, 'missed-epoch');
    await cb.init(b.privateKey, a.publicKey, 'b', 'a', { iAmInitiator: false }, 'missed-epoch');
    await chatA.init(a.privateKey, b.publicKey, 'a', 'b', { iAmInitiator: true });
    await chatB.init(b.privateKey, a.publicKey, 'b', 'a', { iAmInitiator: false });
    const queued = await chatA.encryptFrame('chat is independent');
    const staleReceiver = ca.exportRatchetState();
    // Advance a reference receiver through two exchanges; the restored receiver
    // below has observed neither remote DH epoch (models stale/crashed state).
    for (let i = 0; i < 2; i++) {
      await cb.decryptFrame(await ca.encryptFrame('offer epoch'));
      await ca.decryptFrame(await cb.encryptFrame('answer epoch'));
    }
    await cb.decryptFrame(await ca.encryptFrame('latest offer'));
    const laterEpoch = await cb.encryptFrame('latest answer');
    await ca.importRatchetState(staleReceiver);
    const before = ca.exportRatchetState();
    await expect(ca.decryptFrame(laterEpoch)).rejects.toThrow();
    expect(ca.exportRatchetState()).toEqual(before);
    expect(await chatB.decryptFrame(queued)).toBe('chat is independent');
    expect(await chatA.decryptFrame(await chatB.encryptFrame('still works'))).toBe('still works');
    vi.restoreAllMocks();
  });

});

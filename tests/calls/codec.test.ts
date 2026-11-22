import { describe, it, expect } from 'vitest';
import { decode, encode } from '../../src/calls/codec';

const cid = '11111111-1111-4111-8111-111111111111';
const dev = '22222222-2222-4222-8222-222222222222';
const context = { callId: cid, fromDeviceId: dev, kind: 'offer' as const, attempt: 1 };
const offer = { mc: 1 as const, kind: 'call' as const, t: 'offer' as const, cid, dev, attempt: 1, media: 'audio' as const, sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', ts: 1234 };
describe('authenticated call codec (not chat dispatch)', () => {
  it('round trips the audio offer bound to exact frame context', () => {
    expect(decode(encode(offer), context)).toEqual(offer);
  });
  it.each([
    { mc: 2 }, { kind: 'chat' }, { t: 'unknown' }, { cid: 'bad' }, { dev: 'bad' },
    { attempt: 0 }, { attempt: 1000001 }, { attempt: '1' }, { ts: -1 }, { ts: 1.2 },
    { sdp: '' }, { sdp: {} }, { sdp: 'v=0\r\nm=video 9 RTP/AVP 0\r\n' }, { media: 'video' }, { extra: true },
  ])('rejects malformed offer %j', patch => {
    const b = { ...offer, ...patch };
    expect(decode(JSON.stringify(b), { ...context, attempt: b.attempt as number })).toBeNull();
    expect(() => encode(b as typeof offer)).toThrow();
  });
  it('bounds UTF8 bytes and never throws on hostile input/context', () => {
    expect(decode(JSON.stringify({ ...offer, sdp: offer.sdp + '界'.repeat(5500) }), context)).toBeNull();
    for (const value of [null, {}, 'null', '[]', '1', '{', '"text"']) expect(decode(value, context)).toBeNull();
    expect(decode(JSON.stringify(offer), null as never)).toBeNull();
    for (const patch of [{ callId: dev }, { fromDeviceId: cid }, { kind: 'answer' }, { attempt: 2 }])
      expect(decode(JSON.stringify(offer), { ...context, ...patch } as typeof context)).toBeNull();
  });
  it('validates answer union and ephemeral ice-end mapped to outer ICE', () => {
    const base = { mc: 1, kind: 'call', cid, dev, attempt: 2 };
    for (const body of [
      { ...base, t: 'answer', sdp: offer.sdp, ts: 2 },
      { ...base, t: 'answer', needsOffer: true, ts: 2 },
      { ...base, t: 'ice', cand: 'candidate:1 1 udp 1 192.0.2.1 9 typ host', mid: '0', mline: 0, ufrag: 'abc' },
      { ...base, t: 'ice-end' }, { ...base, t: 'busy', ts: 2 },
      { ...base, t: 'hangup', ts: 2, reason: 'answered-elsewhere' },
    ]) {
      const ctx = { ...context, attempt: 2, kind: body.t === 'ice-end' ? 'ice' : body.t } as typeof context;
      expect(decode(JSON.stringify(body), ctx)).toEqual(body);
    }
    for (const patch of [{}, { needsOffer: false }, { needsOffer: true, sdp: offer.sdp }, { sdp: '' }])
      expect(decode(JSON.stringify({ ...base, t: 'answer', ts: 2, ...patch }), { ...context, kind: 'answer', attempt: 2 })).toBeNull();
    for (const patch of [{ cand: '' }, { cand: 'x'.repeat(4097) }, { mline: -1 }, { mid: {} }, { ufrag: '' }, { nested: {} }])
      expect(decode(JSON.stringify({ ...base, t: 'ice', cand: 'candidate:ok', mid: '0', mline: 0, ufrag: 'abc', ...patch }), { ...context, kind: 'ice', attempt: 2 })).toBeNull();
    expect(decode(JSON.stringify({ ...base, t: 'hangup', ts: 2, reason: 'evil' }), { ...context, kind: 'hangup', attempt: 2 })).toBeNull();
  });
});

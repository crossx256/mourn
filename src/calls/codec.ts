import type { CallBody, EndInputReason, EndReason, SignalContext, SignalKind } from './types';

export const MAX_CALL_BYTES = 16_384;
export const MAX_ATTEMPT = 1_000_000;
export const END_REASONS: readonly EndReason[] = ['normal', 'declined', 'busy', 'timeout', 'failed', 'unavailable', 'cancelled', 'answered-elsewhere', 'link-severed', 'link-expired', 'device-revoked', 'ineligible', 'lost', 'max-duration'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUUID = (v: unknown): v is string => typeof v === 'string' && uuid.test(v);
export const validAttempt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= MAX_ATTEMPT;
export const wireKind = (b: CallBody): SignalKind => b.t === 'ice-end' ? 'ice' : b.t;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && new TextEncoder().encode(v).length <= max;
const sdp = (v: unknown): boolean => str(v, MAX_CALL_BYTES) && v.startsWith('v=0\r\n') && /^m=audio /m.test(v) && !/^m=(?!audio )/m.test(v);
const timestamp = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;
function valid(b: Record<string, unknown>): boolean {
  if (b.mc !== 1 || b.kind !== 'call' || !isUUID(b.cid) || !isUUID(b.dev) || !validAttempt(b.attempt)) return false;
  const keys = ['mc', 'kind', 't', 'cid', 'dev', 'attempt'];
  let ok = false;
  switch (b.t) {
    case 'offer': keys.push('media', 'sdp', 'ts'); ok = b.media === 'audio' && sdp(b.sdp) && timestamp(b.ts); break;
    case 'answer':
      keys.push('ts', 'sdp', 'needsOffer');
      ok = timestamp(b.ts) && (b.needsOffer === true ? !Object.hasOwn(b, 'sdp') : !Object.hasOwn(b, 'needsOffer') && sdp(b.sdp)); break;
    case 'ice':
      keys.push('cand', 'mid', 'mline', 'ufrag');
      ok = str(b.cand, 4096) && b.cand.startsWith('candidate:') && str(b.ufrag, 256)
        && (b.mid === null || str(b.mid, 256)) && (b.mline === null || Number.isInteger(b.mline) && (b.mline as number) >= 0 && (b.mline as number) <= 65535)
        && (b.mid !== null || b.mline !== null); break;
    case 'ice-end': ok = true; break;
    case 'hangup': keys.push('reason', 'ts'); ok = END_REASONS.includes(b.reason as EndReason) && timestamp(b.ts); break;
    case 'busy': keys.push('ts'); ok = timestamp(b.ts); break;
  }
  return ok && Object.keys(b).every(k => keys.includes(k));
}
// Must only be called after authenticating the frame, never on chat plaintext.
export function decode(text: unknown, context: SignalContext): CallBody | null {
  try {
    if (typeof text !== 'string' || text.length > MAX_CALL_BYTES || new TextEncoder().encode(text).length > MAX_CALL_BYTES) return null;
    const b: unknown = JSON.parse(text);
    if (!b || typeof b !== 'object' || Array.isArray(b) || !valid(b as Record<string, unknown>)) return null;
    const body = b as CallBody;
    if (body.cid !== context.callId || body.dev !== context.fromDeviceId || wireKind(body) !== context.kind || body.attempt !== context.attempt) return null;
    return body;
  } catch { return null; }
}
export function encode(body: CallBody): string {
  const text = JSON.stringify(body);
  if (!decode(text, { callId: body.cid, fromDeviceId: body.dev, kind: wireKind(body), attempt: body.attempt })) throw new TypeError('INVALID_CALL_BODY');
  return text;
}
// REST accepts a narrower enum than encrypted/UI reasons.
export function toEndInputReason(reason: EndReason): EndInputReason {
  if (['normal', 'declined', 'busy', 'timeout', 'failed', 'unavailable', 'cancelled'].includes(reason)) return reason as EndInputReason;
  return reason === 'answered-elsewhere' ? 'cancelled' : 'unavailable';
}

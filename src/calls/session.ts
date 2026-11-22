import sodium from 'libsodium-wrappers';
import { isUUID } from './codec';
import type { CallSignalPeer } from './signalTransport';

export const CALL_SESSION_TTL = 24 * 60 * 60 * 1000;
export const CALL_SIGNAL_TTL = 10_000;
export const MAX_CALL_SESSIONS = 64;
export const MAX_CALL_RECEIPTS = 1024;
export interface CallEndpoint { userId: string; deviceId: string; devicePub: string; identityPub: string }
/** Fixed-order JSON arrays are unambiguous across platforms (no delimiter collisions). */
export function callSessionTranscript(callId: string, linkId: string, caller: CallEndpoint, callee: CallEndpoint): string {
  if (!isUUID(callId) || !isUUID(linkId) || caller.userId === callee.userId || caller.deviceId === callee.deviceId) throw new Error('INVALID_CALL_ENDPOINT');
  for (const e of [caller, callee]) {
    if (!e.userId || !isUUID(e.deviceId) || !/^[0-9a-f]{64}$/.test(e.devicePub) || !/^[0-9a-f]{64}$/.test(e.identityPub)) throw new Error('INVALID_CALL_ENDPOINT');
  }
  return JSON.stringify(['mourn/call-session/v1', 'audio', callId, linkId,
    [caller.userId, caller.deviceId, caller.devicePub, caller.identityPub],
    [callee.userId, callee.deviceId, callee.devicePub, callee.identityPub]]);
}
export function callSessionKey(peer: CallSignalPeer, localDeviceId: string): string {
  if (!localDeviceId || !peer.callId || !peer.transcript) throw new Error('INVALID_CALL_SESSION');
  return JSON.stringify(['call-v1', peer.linkId, peer.callId, localDeviceId, peer.deviceId,
    sodium.to_hex(sodium.crypto_generichash(32, sodium.from_string(peer.transcript), null))]);
}

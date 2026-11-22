// Protocol metadata is not authentication. Validate only in the CALL_SIGNAL domain.
export type UUID = string;
export type ServerCallState = 'RINGING' | 'ACTIVE' | 'ENDED' | 'MISSED' | 'DECLINED' | 'BUSY' | 'CANCELLED' | 'FAILED';
export type ClientCallState = 'IDLE' | 'DIALING' | 'RINGING' | 'ACCEPTING' | 'CONNECTING' | 'ACTIVE' | 'RESTARTING' | 'ENDED';
export type EndInputReason = 'normal' | 'declined' | 'busy' | 'timeout' | 'failed' | 'unavailable' | 'cancelled';
export type EndReason = EndInputReason | 'answered-elsewhere' | 'link-severed' | 'link-expired' | 'device-revoked' | 'ineligible' | 'lost' | 'max-duration';
export type QualityBucket = 'good' | 'fair' | 'poor';
export interface ServerCall {
  id: UUID; linkId: UUID; callerId: string; calleeId: string;
  callerDeviceId: UUID; answeredDeviceId: UUID | null; media: 'audio';
  state: ServerCallState; protocolVersion: 1;
  createdAt: string; ringExpiresAt: string; answeredAt: string | null; endedAt: string | null;
  endReason: string | null; relayed: boolean | null; qualityBucket: QualityBucket | null;
}
export interface IceResult { iceServers: RTCIceServer[]; expiresAt: string }
export interface CreateResult extends IceResult {
  callId: UUID; call: ServerCall; settings: { ringSeconds: 60 };
  calleeDevices: { id: UUID; deviceName: string | null; platform: 'ANDROID' | 'IOS' | 'UNKNOWN'; lastSeenAt: string }[];
}
export interface AnswerResult extends IceResult { call: ServerCall }
export interface CallPage<T> { calls: T[]; nextCursor: string | null; hasMore: boolean }
export type SignalKind = 'offer' | 'answer' | 'ice' | 'hangup' | 'busy';
interface BodyBase { mc: 1; kind: 'call'; cid: UUID; dev: UUID; attempt: number }
export type OfferBody = BodyBase & { t: 'offer'; media: 'audio'; sdp: string; ts: number };
export type AnswerBody = BodyBase & { t: 'answer'; ts: number } & ({ sdp: string; needsOffer?: never } | { needsOffer: true; sdp?: never });
export type IceBody = BodyBase & { t: 'ice'; cand: string; mid: string | null; mline: number | null; ufrag: string };
export type CallBody = OfferBody | AnswerBody | IceBody | (BodyBase & { t: 'ice-end' }) | (BodyBase & { t: 'hangup'; reason: EndReason; ts: number }) | (BodyBase & { t: 'busy'; ts: number });
export interface SignalContext { callId: UUID; fromDeviceId: UUID; kind: SignalKind; attempt: number }

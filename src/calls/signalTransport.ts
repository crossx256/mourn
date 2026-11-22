import sodium from 'libsodium-wrappers';
import type { CipherEngine } from '../crypto/engine';
import { decode, encode, isUUID, validAttempt, wireKind } from './codec';
import type { CallBody, SignalKind } from './types';
import { callSessionKey, CALL_SIGNAL_TTL, CALL_SESSION_TTL, MAX_CALL_RECEIPTS } from './session';

export interface OutgoingCallSignal {
  callId: string; signalId: string; targetDeviceId: string; kind: SignalKind; attempt: number;
  needsOffer?: boolean;
  createdAt: string; expiresAt: string;
  ciphertextHex: string; nonceHex: string; senderDHRPubHex: string; messageIndex: number; pn: number;
}
export interface IncomingCallSignal extends Omit<OutgoingCallSignal, 'targetDeviceId'> {
  fromUserId: string; fromDeviceId: string; createdAt: string; expiresAt: string; receiptToken: string;
}
export interface CallSignalPeer { linkId: string; userId: string; deviceId: string; devicePub: string; identityPub: string; callId: string; transcript: string; iAmInitiator: boolean }
export interface ReceivedCallSignal {
  callId: string; signalId: string; linkId: string; fromUserId: string; fromDeviceId: string; body: CallBody;
}
export interface CallSignalGuard { assertCurrent(): void; isCurrent(): boolean }
export interface CallSignalError extends Error { code?: string; callId?: string; targetDeviceId?: string }
/** Call-only RAM engines and queue namespace. Never reuse a chat ratchet. */
export interface CallSignalPort {
  queues(): Map<string, Promise<void>>;
  deviceId(): string | null;
  capture(): CallSignalGuard;
  ensureConnected(): Promise<void>;
  resolvePeer(callId: string, deviceId: string, userId?: string): Promise<CallSignalPeer>;
  getEngine(peer: CallSignalPeer, key: string): Promise<CipherEngine>;
  releaseCall?(callId: string): void;
  send(packet: OutgoingCallSignal): void;
  ack(callId: string, signalId: string, receiptToken: string): void;

}

type Listener<T> = (event: T) => void;
type SignalListener = (event: ReceivedCallSignal) => void | Promise<void>;
const hex = (v: unknown, n?: number): v is string => typeof v === 'string' && (n === undefined ? v.length > 0 && v.length <= 65536 && v.length % 2 === 0 : v.length === n) && /^[0-9a-f]+$/.test(v);
const counter = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
function validPacket(p: IncomingCallSignal): boolean {
  return !!p && isUUID(p.callId) && isUUID(p.signalId) && isUUID(p.fromDeviceId)
    && typeof p.fromUserId === 'string' && p.fromUserId.length > 0
    && ['offer', 'answer', 'ice', 'hangup', 'busy'].includes(p.kind) && validAttempt(p.attempt)
    && hex(p.ciphertextHex) && hex(p.nonceHex, 48) && hex(p.senderDHRPubHex, 64)
    && hex(p.receiptToken, 64)
    && counter(p.messageIndex) && counter(p.pn)
    && (p.needsOffer === undefined || typeof p.needsOffer === 'boolean')
    && Number.isFinite(Date.parse(p.createdAt)) && Number.isFinite(Date.parse(p.expiresAt));
}
function receiptHash(peer: CallSignalPeer, p: IncomingCallSignal): string {
  return sodium.to_hex(sodium.crypto_generichash(32, sodium.from_string(JSON.stringify([
    'mourn/call-receipt/v1', peer.transcript, peer.linkId, peer.devicePub, peer.identityPub, p.callId, p.signalId,
    p.fromUserId, p.fromDeviceId, p.kind, p.attempt, p.needsOffer ?? null,
    p.ciphertextHex, p.nonceHex, p.senderDHRPubHex, p.messageIndex, p.pn, p.createdAt, p.expiresAt,
  ])), null));
}

/** No chat rows or plaintext queues. Relay metadata is never treated as AEAD authority. */
export class CallSignalTransport {
  private disposed = false;
  private epoch = 0;
  private readonly dispatched = new Map<string, number>();
  private readonly admitted = new Map<string, { expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  // Never evict tombstones and silently recreate a responder chain. Fail closed
  // at the per-controller lifetime limit; a new controller needs new admission.
  private readonly used = new Set<string>();
  private readonly retiring = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly receipts = new Map<string, { callId: string; hash: string; expiresAt: number; event: ReceivedCallSignal }>();
  private readonly sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of this.receipts) if (entry.expiresAt <= now) { this.receipts.delete(id); this.dispatched.delete(entry.hash); }
  }, 1000);
  /** Boot must reconcile stale owned calls BEFORE admitting a fresh RINGING ID.
   * Admission is explicit and process-local, never inferred from an ACTIVE row. */
  admitCall(callId: string): void {
    this.guard().assertCurrent();
    if (!isUUID(callId)) throw new Error('INVALID_CALL_ID');
    if (this.admitted.has(callId)) return;
    if (this.used.has(callId)) throw new Error('CALL_SESSION_RETIRED');
    if (this.used.size >= 256) throw new Error('CALL_ADMISSION_BACKPRESSURE');
    this.used.add(callId);
    this.admitted.set(callId, { expiresAt: Date.now() + CALL_SESSION_TTL, timer: setTimeout(() => this.cancelCall(callId), CALL_SESSION_TTL) });
  }
  assertAdmitted(callId: string): void {
    const entry = this.admitted.get(callId);
    if (!entry || entry.expiresAt <= Date.now()) throw new Error('CALL_NOT_ADMITTED');
  }
  private readonly dispatching = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, { packet: OutgoingCallSignal; operation: CallSignalGuard; timers: ReturnType<typeof setTimeout>[] }>();
  private readonly incoming = new Set<Listener<unknown>>();
  private readonly ready = new Set<Listener<unknown>>();
  private readonly states = new Set<Listener<unknown>>();
  get pendingCount(): number { return this.pending.size; }
  onIncoming(listener: Listener<unknown>): () => void { this.incoming.add(listener); return () => this.incoming.delete(listener); }
  onReady(listener: Listener<unknown>): () => void { this.ready.add(listener); return () => this.ready.delete(listener); }
  handleReady(event: unknown): void { if (!this.disposed) this.emit(this.ready, event); }
  onState(listener: Listener<unknown>): () => void { this.states.add(listener); return () => this.states.delete(listener); }
  /** These are relay hints only; callers must fetch/validate the authoritative call. */
  handleIncoming(event: unknown): void { if (!this.disposed) this.emit(this.incoming, event); }
  handleState(event: unknown): void { if (!this.disposed) this.emit(this.states, event); }
  private forget(id: string): void {
    const entry = this.pending.get(id);
    entry?.timers.forEach(clearTimeout);
    this.pending.delete(id);
  }
  /** A relay storage acknowledgement is NOT proof of receiver decryption. */
  handleStored(event: unknown): void { void event; /* Retain peer-ACK retry budget. */ }
  handleAck(event: unknown): void {
    const p = event as { signalId?: string; callId?: string; fromDeviceId?: string; accepted?: boolean } | null;
    const entry = p?.signalId ? this.pending.get(p.signalId) : undefined;
    if (entry && p?.accepted === true && p.callId === entry.packet.callId && p.fromDeviceId === entry.packet.targetDeviceId) this.forget(entry.packet.signalId);
  }
  handleError(event: unknown): void {
    const p = event as { signalId?: string; callId?: string; code?: string } | null;
    if (!p || typeof p.code !== 'string') return;
    // Uncorrelated errors cannot cancel arbitrary calls. The bounded retry timeout handles them.
    const entry = p.signalId ? this.pending.get(p.signalId) : undefined;
    if (entry && p.callId === entry.packet.callId) {
      this.forget(entry.packet.signalId);
      this.reportError(Object.assign(new Error(`CALL_SIGNAL_REJECTED:${p.code}`), { code: p.code, callId: entry.packet.callId, targetDeviceId: entry.packet.targetDeviceId }));
    }
  }
  /** Privacy invalidation cancels all in-flight work; there is one active call.
   * Fresh operations still have to resolve live authoritative link membership. */
  invalidateLink(linkId: string): void {
    void linkId;
    this.epoch++;
    for (const id of [...this.admitted.keys()]) this.cancelCall(id);
  }
  /** A socket generation ended. Never resurrect its queued ciphertext later. */
  handleDisconnect(): void {
    this.epoch++;
    for (const id of this.pending.keys()) this.forget(id);
  }
  cancelCall(callId: string): void {
    clearTimeout(this.retiring.get(callId));
    this.retiring.delete(callId);
    const entry = this.admitted.get(callId); if (entry) clearTimeout(entry.timer);
    this.admitted.delete(callId);
    for (const [id, receipt] of this.receipts) if (receipt.callId === callId) { this.receipts.delete(id); this.dispatched.delete(receipt.hash); }
    this.port.releaseCall?.(callId);
    for (const [id, entry] of this.pending) if (entry.packet.callId === callId) this.forget(id);
  }
  /** Keep only a signal-TTL grace for terminal controls/ACKs, then release keys. */
  retireCall(callId: string): void {
    if (this.disposed || !this.admitted.has(callId) || this.retiring.has(callId)) return;
    this.retiring.set(callId, setTimeout(() => this.cancelCall(callId), CALL_SIGNAL_TTL));
  }
  private handoff(packet: OutgoingCallSignal, operation: CallSignalGuard, expiresAt = Date.parse(packet.expiresAt)): void {
    if (expiresAt <= Date.now()) return;
    if (packet.kind === 'ice') { this.port.send(packet); return; }
    if (this.pending.size >= 200) throw new Error('CALL_SIGNAL_BACKPRESSURE');
    const entry = { packet, operation, timers: [] as ReturnType<typeof setTimeout>[] };
    this.pending.set(packet.signalId, entry);
    try { this.port.send(packet); } catch (error) { this.forget(packet.signalId); throw error; }
    // A synchronous transport/test recipient may have already ACKed.
    if (!this.pending.has(packet.signalId)) return;
    for (const delay of [2000, 6000].filter(ms => Date.now() + ms < expiresAt)) entry.timers.push(setTimeout(() => {
      if (!this.admitted.has(packet.callId) || !entry.operation.isCurrent() || Date.now() >= expiresAt) { this.forget(packet.signalId); return; }
      try { this.port.send(entry.packet); } catch (error) {
        this.forget(packet.signalId); this.reportError(error);
      }
    }, delay));
    entry.timers.push(setTimeout(() => {
      this.forget(packet.signalId);
      if (entry.operation.isCurrent()) this.reportError(new Error('CALL_SIGNAL_ACK_TIMEOUT'));
    }, Math.max(0, expiresAt - Date.now())));
  }
  private readonly signals = new Set<SignalListener>();
  private readonly errors = new Set<Listener<CallSignalError>>();
  constructor(private readonly port: CallSignalPort) {}
  onSignal(listener: SignalListener): () => void { this.signals.add(listener); return () => this.signals.delete(listener); }
  onError(listener: Listener<CallSignalError>): () => void { this.errors.add(listener); return () => this.errors.delete(listener); }
  private emit<T>(listeners: Set<Listener<T>>, event: T): void {
    for (const listener of listeners) {
      try { listener(event); } catch { /* A consumer cannot poison a committed ratchet receipt. */ }
    }
  }
  reportError(error: unknown): void { this.emit(this.errors, error instanceof Error ? error : new Error('CALL_SIGNAL_FAILED')); }
  private guard(): CallSignalGuard {
    if (this.disposed) throw new Error('CALL_TRANSPORT_DISPOSED');
    const operation = this.port.capture();
    const epoch = this.epoch;
    return {
      assertCurrent: () => { operation.assertCurrent(); if (epoch !== this.epoch) throw new Error('CALL_OPERATION_SUPERSEDED'); if (this.disposed) throw new Error('CALL_TRANSPORT_DISPOSED'); },
      isCurrent: () => !this.disposed && epoch === this.epoch && operation.isCurrent(),
    };
  }
  private async serial<T>(key: string, operation: CallSignalGuard, work: () => Promise<T>): Promise<T> {
    const queues = this.port.queues();
    const previous = queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(() => { operation.assertCurrent(); return work(); });
    const tail = result.then(() => {});
    queues.set(key, tail);
    // Consume the void tail's rejection too: the returned result is the sole error channel.
    void tail.catch(() => {});
    try { return await result; } finally { if (queues.get(key) === tail) queues.delete(key); }
  }
  async send(linkId: string, partnerUserId: string, devices: readonly { id: string; devicePub?: string }[], body: CallBody): Promise<string[]> {
    const operation = this.guard();
    const payload = JSON.parse(encode(body)) as CallBody;
    this.assertAdmitted(payload.cid);
    if (payload.dev !== this.port.deviceId()) throw new Error('CALL_SENDER_MISMATCH');
    if (!devices.length || new Set(devices.map(d => d.id)).size !== devices.length) throw new Error('INVALID_CALL_TARGETS');
    // Fail offline BEFORE consuming any ratchet index. Never enqueue stale plaintext offers.
    await this.port.ensureConnected(); operation.assertCurrent();
    const ids: string[] = [];
    try {
      for (const device of devices) {
        if (!isUUID(device.id)) throw new Error('INVALID_CALL_TARGET');
        const peer = await this.port.resolvePeer(payload.cid, device.id, partnerUserId); operation.assertCurrent();
        if (peer.callId !== payload.cid || peer.linkId !== linkId || peer.userId !== partnerUserId || peer.deviceId !== device.id) throw new Error('CALL_PEER_MISMATCH');
        const key = callSessionKey(peer, this.port.deviceId()!);
        const packet = await this.serial(key, operation, async () => {
          this.assertAdmitted(payload.cid);
          const engine = await this.port.getEngine(peer, key); operation.assertCurrent();
          this.assertAdmitted(payload.cid);
          const snapshot = engine.exportRatchetState();
          let committed = false;
          try {
            const signalId = crypto.randomUUID();
            const now = Date.now();
            const createdAt = new Date(now).toISOString(), expiresAt = new Date(now + CALL_SIGNAL_TTL).toISOString();
            const frame = await engine.encryptFrame(JSON.stringify(['mourn/call-signal/v2', signalId, payload.dev, device.id, createdAt, expiresAt, payload])); operation.assertCurrent();
            this.assertAdmitted(payload.cid);
            const packet: OutgoingCallSignal = {
              callId: payload.cid, signalId, targetDeviceId: device.id, createdAt, expiresAt,
              kind: wireKind(payload), attempt: payload.attempt,
              ...(payload.t === 'answer' && payload.needsOffer === true ? { needsOffer: true } : {}),
              ciphertextHex: sodium.to_hex(frame.ciphertext), nonceHex: sodium.to_hex(frame.nonce),
              senderDHRPubHex: sodium.to_hex(frame.senderDHRPub), messageIndex: frame.messageIndex, pn: frame.PN,
            };
            committed = true;
            operation.assertCurrent();
            return packet;
          } catch (error) {
            if (!committed) await engine.importRatchetState(snapshot);
            throw error;
          }
        });
        operation.assertCurrent();
        this.assertAdmitted(payload.cid);
        this.handoff(packet, operation); ids.push(packet.signalId);
      }
      return ids;
    } catch (error) {
      // Some peers may already have received frames. Never rewind committed keys,
      // but remove this failed fan-out's retry timers so manager cleanup is final.
      for (const id of ids) this.forget(id);
      throw error;
    }
  }
  async receive(packet: IncomingCallSignal): Promise<void> {
    const operation = this.guard();
    if (!validPacket(packet)) throw new Error('INVALID_CALL_SIGNAL');
    this.assertAdmitted(packet.callId);
    // Expiry is only a rejection hint, never authority to ACK or dispatch.
    if (Date.parse(packet.expiresAt) <= Date.now()) return;
    if (Date.parse(packet.createdAt) > Date.now() + 5000 || Date.parse(packet.expiresAt) <= Date.parse(packet.createdAt) || Date.parse(packet.expiresAt) - Date.parse(packet.createdAt) > CALL_SIGNAL_TTL) throw new Error('INVALID_CALL_SIGNAL_LIFETIME');
    const peer = await this.port.resolvePeer(packet.callId, packet.fromDeviceId, packet.fromUserId); operation.assertCurrent();
    if (peer.callId !== packet.callId || peer.deviceId !== packet.fromDeviceId || peer.userId !== packet.fromUserId) throw new Error('CALL_PEER_MISMATCH');
    const key = callSessionKey(peer, this.port.deviceId()!);
    const hash = receiptHash(peer, packet);
    const accepted = await this.serial<ReceivedCallSignal | null>(key, operation, async () => {
      this.assertAdmitted(packet.callId);
      const receiptId = JSON.stringify([key, packet.signalId]);
      const old = this.receipts.get(receiptId);
      if (old) {
        if (old.hash !== hash) throw new Error('CALL_SIGNAL_CONFLICT');
        return old.event;
      }
      if (this.receipts.size >= MAX_CALL_RECEIPTS) throw new Error('CALL_RECEIPT_BACKPRESSURE');
      const engine = await this.port.getEngine(peer, key); operation.assertCurrent();
      this.assertAdmitted(packet.callId);
      const snapshot = engine.exportRatchetState();
      let body: CallBody;
      let committed = false;
      try {
        const text = await engine.decryptFrame({ ciphertext: sodium.from_hex(packet.ciphertextHex), nonce: sodium.from_hex(packet.nonceHex), senderDHRPub: sodium.from_hex(packet.senderDHRPubHex), messageIndex: packet.messageIndex, PN: packet.pn }, { senderIdentityKey: sodium.from_hex(peer.identityPub) });
        operation.assertCurrent();
        let envelope: unknown;
        try { envelope = JSON.parse(text); } catch { throw new Error('INVALID_CALL_ENVELOPE'); }
        if (!Array.isArray(envelope) || envelope.length !== 7 || envelope[0] !== 'mourn/call-signal/v2' || envelope[1] !== packet.signalId || envelope[2] !== packet.fromDeviceId || envelope[3] !== this.port.deviceId() || envelope[4] !== packet.createdAt || envelope[5] !== packet.expiresAt || !envelope[6] || typeof envelope[6] !== 'object' || Array.isArray(envelope[6])) throw new Error('CALL_AUTHENTICATED_METADATA_MISMATCH');
        const decoded = decode(JSON.stringify(envelope[6]), { callId: packet.callId, fromDeviceId: packet.fromDeviceId, kind: packet.kind, attempt: packet.attempt });
        if (!decoded || packet.needsOffer !== (decoded.t === 'answer' ? decoded.needsOffer : undefined)) throw new Error('CALL_AUTHENTICATED_METADATA_MISMATCH');
        body = decoded;
        this.assertAdmitted(packet.callId);
        if (Date.parse(packet.expiresAt) <= Date.now()) throw new Error('CALL_SIGNAL_EXPIRED');
        this.receipts.set(receiptId, { callId: packet.callId, hash, expiresAt: Date.parse(packet.expiresAt), event: { callId: packet.callId, signalId: packet.signalId, linkId: peer.linkId, fromUserId: peer.userId, fromDeviceId: peer.deviceId, body } });
        committed = true; operation.assertCurrent();
      } catch (error) {
        if (!committed) await engine.importRatchetState(snapshot);
        throw error;
      }
      return { callId: packet.callId, signalId: packet.signalId, linkId: peer.linkId, fromUserId: peer.userId, fromDeviceId: peer.deviceId, body };
    });
    // Never hold an engine lock while calling a consumer: it may synchronously
    // need to send on the same session, or await manager boot readiness.
    operation.assertCurrent();
    this.assertAdmitted(packet.callId);
    if (accepted) await this.dispatch(hash, accepted, operation, Date.parse(packet.expiresAt));
    operation.assertCurrent();
    this.assertAdmitted(packet.callId);
    if (packet.kind !== 'ice' && Date.parse(packet.expiresAt) > Date.now()) this.port.ack(packet.callId, packet.signalId, packet.receiptToken);
  }
  private async dispatch(hash: string, event: ReceivedCallSignal, operation: CallSignalGuard, expiresAt: number): Promise<void> {
    if (this.dispatched.has(hash)) return;
    if (!this.signals.size) throw new Error('CALL_SIGNAL_CONSUMER_UNAVAILABLE');
    const running = this.dispatching.get(hash);
    if (running) { await running; operation.assertCurrent(); return; }
    const work = (async () => {
      // Defer invocation until the in-flight promise is registered, including
      // synchronous consumers which trigger another replay/receive.
      await Promise.resolve(); operation.assertCurrent();
      this.assertAdmitted(event.callId);
      if (expiresAt <= Date.now()) throw new Error('CALL_SIGNAL_EXPIRED');
      try { await Promise.all([...this.signals].map(async listener => { await listener(event); })); }
      catch { throw new Error('CALL_SIGNAL_CONSUMER_FAILED'); }
      operation.assertCurrent();
      this.assertAdmitted(event.callId);
      const now = Date.now();
      for (const [id, expiresAt] of this.dispatched) if (expiresAt <= now) this.dispatched.delete(id);
      if (this.dispatched.size >= 1024) this.dispatched.delete(this.dispatched.keys().next().value!);
      // Delivery evidence exists only in RAM until packet expiry.
      if (expiresAt > now) this.dispatched.set(hash, expiresAt);
    })();
    this.dispatching.set(hash, work);
    try { await work; } finally { if (this.dispatching.get(hash) === work) this.dispatching.delete(hash); }
  }
  dispose(): void {
    this.disposed = true;
    clearInterval(this.sweep);
    for (const id of [...this.admitted.keys()]) this.cancelCall(id);
    this.receipts.clear(); this.dispatching.clear();
    for (const id of this.pending.keys()) this.forget(id);
    this.signals.clear(); this.errors.clear(); this.incoming.clear(); this.states.clear(); this.ready.clear(); this.dispatched.clear();
  }
}

import { initialState, reduce } from './callMachine';
import type { MachineEvent, MachineEffect, MachineState, Timer } from './callMachine';
import type {
  AnswerResult,
  CallBody,
  CreateResult,
  EndReason,
  IceResult,
  ServerCall,
} from './types';
import { END_REASONS, toEndInputReason } from './codec';
import type { CallStats } from './media/browserMedia';
export type QualityReport = Pick<CallStats, 'relayed' | 'qualityBucket'>;

export interface CallsApi {
  create(linkId: string): Promise<CreateResult>;
  answer(id: string): Promise<AnswerResult>;
  get(id: string): Promise<ServerCall>;
  active(): Promise<ServerCall[]>;
  ready(id: string): Promise<void>;
  ice(id: string): Promise<IceResult>;
  end(id: string, reason: ReturnType<typeof toEndInputReason>, report?: QualityReport): Promise<void>;
  decline(id: string): Promise<void>;
}
/** Only authenticated CALL_SIGNAL-domain plaintext may cross this seam. */
export interface CallTransport {
  /** `created` is supplied only by this device's successful create request. */
  admit?(callId: string, created?: ServerCall): Promise<void>;
  retire?(callId: string): void;
  send(linkId: string, targetDeviceId: string, body: CallBody): Promise<unknown>;
}
export interface CallMedia {
  startOutgoing(ice: RTCIceServer[], attempt: number): Promise<string>;
  acceptOffer(sdp: string, ice: RTCIceServer[], attempt: number): Promise<string>;
  setRemoteAnswer(sdp: string): Promise<void>;
  addIce(candidate: RTCIceCandidateInit | null): Promise<void>;
  restartIce(ice?: RTCIceServer[], attempt?: number): Promise<string>;
  setMuted(muted: boolean): void;
  close(): Promise<void>;
}
export interface MediaEvents {
  onStats(stats: CallStats): void;
  onIce(candidate: RTCIceCandidateInit | null, attempt: number): void;
  onConnectionState(state: RTCPeerConnectionState, attempt: number): void;
  onError(code: string): void;
}
export interface ManagerOptions {
  api: CallsApi;
  transport: CallTransport;
  localDeviceId: string;
  userId: string;
  createMedia(events: MediaEvents): CallMedia;
  onChange?(state: MachineState, call: ServerCall | null): void;
  prepareMedia?(): Promise<void>;
  releaseMedia?(): Promise<void>;
  onEnded?(reason: EndReason): void;
  onStats?(stats: CallStats): void;
}
export class CallManager {
  state: MachineState = initialState;
  call: ServerCall | null = null;
  enabled = false;
  private ended = new Set<string>();
  private generation = 0;
  private cleanup: Promise<void> = Promise.resolve();
  private media = new Map<string, CallMedia>();
  private offers = new Map<string, CallBody & { t: 'offer' }>();
  private outgoingOffers = new Map<string, CallBody & { t: 'offer' }>();
  private answers = new Map<string, CallBody & { t: 'answer' }>();
  private candidates = new Map<string, (RTCIceCandidateInit | null)[]>();
  private ready = new Set<string>();
  private timers = new Map<Timer, ReturnType<typeof setTimeout>>();
  private ice: RTCIceServer[] = [];
  private targets: string[] = [];
  private linkId = '';
  private muted = false;
  private quality: QualityReport | undefined;
  private end(id: string, reason: ReturnType<typeof toEndInputReason>) {
    return this.quality ? this.options.api.end(id, reason, { ...this.quality }) : this.options.api.end(id, reason);
  }
  constructor(private readonly options: ManagerOptions) {}
  get busy() {
    return this.state.phase !== 'IDLE' && this.state.phase !== 'ENDED';
  }
  setTransport(transport: CallTransport) {
    this.options.transport = transport;
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) return this.dispatch({ type: 'FEATURE_OFF' });
    return Promise.resolve();
  }
  private fresh() {
    this.generation++;
    this.state = initialState;
    this.call = null;
    this.offers.clear();
    this.outgoingOffers.clear();
    this.answers.clear();
    this.candidates.clear();
    this.ready.clear();
    this.targets = [];
    this.quality = undefined;
  }
  async dial(linkId: string) {
    const generation = this.generation;
    await this.cleanup;
    if (generation !== this.generation) return;
    if (!this.enabled || this.busy) throw new Error('CALLS_UNAVAILABLE');
    this.fresh();
    this.linkId = linkId;
    await this.dispatch({ type: 'DIAL', localDeviceId: this.options.localDeviceId });
  }
  async incoming(call: ServerCall) {
    const generation = this.generation;
    await this.cleanup;
    if (generation !== this.generation) return;
    if (this.ended.has(call.id)) return;
    if (
      !this.enabled ||
      call.calleeId !== this.options.userId ||
      call.state !== 'RINGING' ||
      Date.parse(call.ringExpiresAt) <= Date.now()
    )
      return;
    if (this.busy) {
      if (this.call?.id === call.id) return;
      // Server busy/glare authority wins; never replace a live media session on a socket hint.
      return;
    }
    await this.options.transport.admit?.(call.id);
    if (generation !== this.generation || !this.enabled || this.busy || this.ended.has(call.id)) return;
    this.fresh();
    this.call = call;
    this.linkId = call.linkId;
    this.targets = [call.callerDeviceId];
    await this.dispatch({
      type: 'INCOMING',
      callId: call.id,
      localDeviceId: this.options.localDeviceId,
      peerDeviceId: call.callerDeviceId,
      hasOffer: false,
      ringRemainingMs: Date.parse(call.ringExpiresAt) - Date.now(),
    });
    await this.announceReady(call.id);
  }
  accept() {
    return this.dispatch({ type: 'ACCEPT' });
  }
  decline() {
    return this.dispatch({ type: 'DECLINE' });
  }
  hangup() {
    return this.dispatch({ type: 'HANGUP' });
  }
  async logout() {
    const ending = this.busy && this.call ? this.call.id : null;
    const participant =
      this.state.phase !== 'IDLE' &&
      (this.state.role === 'caller' || this.state.winnerDeviceId === this.options.localDeviceId);
    this.generation++;
    this.enabled = false;
    await this.dispatch({ type: 'LOGOUT' });
    this.call = null;
    this.state = initialState;
    this.changed();
    if (ending) {
      try {
        if (participant) await this.end(ending, 'cancelled');
        else await this.options.api.decline(ending);
      } catch {
        /* Local media is already stopped; revoked sessions cannot write. */
      }
    }
  }
  setMuted(value: boolean) {
    this.muted = value;
    for (const media of this.media.values()) media.setMuted(value);
  }
  event(event: MachineEvent) {
    return this.dispatch(event);
  }
  async serverState(call: ServerCall) {
    if (call.id !== this.call?.id) {
      await this.incoming(call);
      return;
    }
    this.call = call;
    await this.dispatch({
      type: 'SERVER_STATE',
      callId: call.id,
      state: call.state,
      answeredDeviceId: call.answeredDeviceId,
      reason: END_REASONS.includes(call.endReason as EndReason) ? call.endReason as EndReason : undefined,
    });
    if (this.state.phase !== 'IDLE' && this.state.phase !== 'ENDED' && this.state.winnerDeviceId) {
      const winner = this.state.winnerDeviceId;
      for (const [id, media] of this.media)
        if (id !== winner && this.state.role === 'caller') {
          await media.close();
          this.media.delete(id);
        }
      const answer = this.answers.get(winner);
      if (answer) await this.signal(answer);
    }
  }
  /** Boot only: memory-only SDP/ICE cannot survive a manager/process recreation. */
  async discardInterruptedCalls() {
    const generation = this.generation;
    if (!this.enabled || this.busy) return;
    const calls = await this.options.api.active();
    for (const call of calls) {
      if (generation !== this.generation || !this.enabled) return;
      const owned = (call.callerId === this.options.userId && call.callerDeviceId === this.options.localDeviceId) ||
        (call.calleeId === this.options.userId && call.answeredDeviceId === this.options.localDeviceId);
      if (owned && (call.state === 'ACTIVE' || call.state === 'RINGING')) {
        this.ended.add(call.id);
        await this.options.api.end(call.id, 'failed');
      }
    }
    for (const call of calls) {
      if (generation !== this.generation || !this.enabled || this.busy) return;
      try {
        await this.incoming(call);
      } catch (error) {
        // A cold ring predating this process cannot be admitted. It must not
        // reject the boot barrier or prevent the next fresh ring being tried.
        const code = (error as { response?: { data?: { code?: string } } } | null)?.response?.data?.code;
        if (!(error instanceof Error && ['CALL_FRESH_RING_REQUIRED', 'CALL_SESSION_RETIRED'].includes(error.message)) &&
          !['CALL_ENDED', 'ANSWERED_ELSEWHERE', 'NOT_PARTICIPANT'].includes(code ?? '')) throw error;
      }
    }
  }
  async announceReady(callId: string) {
    if (!this.enabled || this.call?.id !== callId || this.state.phase !== 'RINGING' || this.state.role !== 'callee') return;
    await this.options.api.ready(callId);
  }
  /** CALL_READY is authenticated metadata, but REST remains lifecycle authority. */
  async peerReady(callId: string, deviceId: string) {
    const generation = this.generation;
    if (!this.enabled || this.call?.id !== callId || this.state.phase !== 'DIALING' ||
      this.state.role !== 'caller' || !this.targets.includes(deviceId)) return;
    const call = await this.options.api.get(callId);
    if (generation !== this.generation || this.call?.id !== callId || !this.enabled ||
      this.state.phase !== 'DIALING' || call.state !== 'RINGING' ||
      call.callerId !== this.options.userId || call.callerDeviceId !== this.options.localDeviceId ||
      Date.parse(call.ringExpiresAt) <= Date.now()) return;
    const attempt = this.state.attempt;
    await this.offering.get(deviceId);
    if (generation !== this.generation || this.state.phase !== 'DIALING' || this.call?.id !== callId) return;
    const offer = this.outgoingOffers.get(deviceId);
    if (offer && this.media.has(deviceId)) {
      // Readiness can race the initial offer's delivery. Preserve that exact
      // negotiation/PC so an answer to it cannot target a discarded connection.
      await this.send(deviceId, { ...offer, ts: Date.now() });
      return;
    }
    await this.options.prepareMedia?.();
    if (generation !== this.generation || this.state.phase !== 'DIALING' || this.call?.id !== callId) return;
    await this.offerTarget(deviceId, attempt, generation);
  }
  async reconcile() {
    const generation = this.generation;
    const id = this.call?.id;
    if (id) {
      const call = await this.options.api.get(id);
      if (generation === this.generation && this.enabled) {
        await this.serverState(call);
        if (generation === this.generation) await this.announceReady(call.id);
      }
    } else {
      const calls = await this.options.api.active();
      if (generation !== this.generation || !this.enabled) return;
      for (const call of calls) {
        if (generation !== this.generation) return;
        await this.incoming(call);
      }
    }
  }
  async signal(body: CallBody) {
    const generation = this.generation;
    if (this.ended.has(body.cid)) return;
    if (!this.enabled) return;
    if (!this.call || !this.busy) {
      if (body.t !== 'offer') return;
      const call = await this.options.api.get(body.cid);
      if (generation !== this.generation || !this.enabled) return;
      await this.incoming(call);
    }
    if (
      !this.call ||
      body.cid !== this.call.id ||
      this.state.phase === 'IDLE' ||
      this.state.phase === 'ENDED'
    )
      return;
    const state = this.state;
    if (
      state.role === 'callee'
        ? body.dev !== this.call.callerDeviceId
        : !this.targets.includes(body.dev) && body.dev !== this.call.answeredDeviceId
    )
      return;
    if (body.t === 'offer') {
      if (state.role !== 'callee') return;
      if (body.attempt < state.attempt || body.attempt > state.attempt + 1) return;
      this.offers.set(body.dev, body);
      await this.dispatch({
        type: 'OFFER',
        callId: body.cid,
        attempt: body.attempt,
        deviceId: body.dev,
      }, true);
    } else if (body.t === 'answer') {
      if (state.role !== 'caller') return;
      this.answers.set(body.dev, body);
      if (!state.winnerDeviceId) {
        const call = await this.options.api.get(body.cid);
        if (generation !== this.generation || !this.busy || this.call?.id !== body.cid) return;
        await this.serverState(call);
        return;
      }
      await this.dispatch({
        type: 'ANSWER',
        callId: body.cid,
        attempt: body.attempt,
        deviceId: body.dev,
        needsOffer: body.needsOffer === true,
      }, true);
    } else if (body.t === 'ice' || body.t === 'ice-end') {
      if (body.attempt !== state.attempt) return;
      const candidate =
        body.t === 'ice-end'
          ? null
          : {
              candidate: body.cand,
              sdpMid: body.mid,
              sdpMLineIndex: body.mline,
              usernameFragment: body.ufrag,
            };
      if (this.ready.has(body.dev)) await this.media.get(body.dev)?.addIce(candidate);
      else {
        const queue = this.candidates.get(body.dev) ?? [];
        if (queue.length < 128) queue.push(candidate);
        this.candidates.set(body.dev, queue);
      }
    } else if (body.t === 'hangup' || body.t === 'busy') {
      // Declines are per endpoint. Only server state can end the caller's ring globally.
      if (state.role === 'caller' && !state.winnerDeviceId) {
        await this.reconcile();
        return;
      }
      await this.dispatch({
        type: 'REMOTE_END',
        callId: body.cid,
        attempt: body.attempt,
        deviceId: body.dev,
        reason: body.t === 'busy' ? 'busy' : body.reason,
      });
    }
  }
  private changed() {
    this.options.onChange?.(this.state, this.call);
  }
  private async dispatch(event: MachineEvent, propagateError = false): Promise<void> {
    const previous = this.state;
    const transition = reduce(this.state, event);
    this.state = transition.state;
    if (this.state.phase === 'ENDED' && previous.phase !== 'ENDED') {
      if (this.call) this.ended.add(this.call.id);
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      const sessions = [...this.media.values()];
      this.media.clear();
      this.offers.clear();
      this.outgoingOffers.clear();
      this.answers.clear();
      this.candidates.clear();
      this.muted = false;
      this.ready.clear();
      this.cleanup = Promise.allSettled(sessions.map((media) => media.close()))
        .then(async () => {
          await this.options.releaseMedia?.();
        })
        .catch(() => {});
      this.changed();
      if (this.ended.size > 256) this.ended.delete(this.ended.values().next().value!);
      this.options.onEnded?.(this.state.reason);
      // Capture terminal targets before yielding: a new call must never redirect an old hangup/end.
      const endingCall = this.call;
      const endingState = this.state;
      const unansweredCallee = endingState.role === 'callee' &&
        endingState.winnerDeviceId !== this.options.localDeviceId;
      const linkId = this.linkId;
      const pending: Promise<unknown>[] = [this.cleanup];
      for (const effect of transition.effects) {
        if (!endingCall) continue;
        if (effect.type === 'SEND_HANGUP' && !unansweredCallee)
          for (const target of this.targets)
            pending.push(
              this.options.transport.send(linkId, target, {
                mc: 1,
                kind: 'call',
                cid: endingCall.id,
                dev: this.options.localDeviceId,
                attempt: endingState.attempt,
                t: 'hangup',
                reason: effect.reason,
                ts: Date.now(),
              }),
            );
        if (effect.type === 'END_CALL')
          pending.push(unansweredCallee
            ? this.options.api.decline(endingCall.id)
            : this.end(endingCall.id, toEndInputReason(effect.reason)));
        if (effect.type === 'DECLINE_CALL') pending.push(this.options.api.decline(endingCall.id));
      }
      if (endingCall) this.options.transport.retire?.(endingCall.id);
      await Promise.allSettled(pending);
      if (transition.effects.some(effect => effect.type === 'RECONCILE') &&
        this.enabled && this.state === endingState) await this.reconcile();
      return;
    }
    this.changed();
    const generation = this.generation;
    for (const effect of transition.effects) {
      if (generation !== this.generation || !this.busy) return;
      try {
        await this.effect(effect, generation);
      } catch (error) {
        if (generation !== this.generation) { if (propagateError) throw error; return; }
        if (this.state.phase !== 'IDLE' && this.state.phase !== 'ENDED')
          await this.dispatch({
            type: 'MEDIA_ERROR',
            callId: this.state.callId,
            attempt: this.state.attempt,
          });
        if (propagateError) throw error;
      }
    }
  }
  private base(attempt: number) {
    return {
      mc: 1 as const,
      kind: 'call' as const,
      cid: this.call!.id,
      dev: this.options.localDeviceId,
      attempt,
    };
  }
  private send(target: string, body: CallBody) {
    return this.options.transport.send(this.linkId, target, body);
  }
  private newMedia(target: string): CallMedia {
    const generation = this.generation;
    const current = () => generation === this.generation && this.busy && this.media.get(target) === media;
    const media = this.options.createMedia({
      onStats: stats => {
        if (!current() || this.state.phase !== 'ACTIVE') return;
        if (this.state.role === 'caller' && this.state.winnerDeviceId !== target) return;
        const rank = { good: 0, fair: 1, poor: 2 };
        const qualityBucket = this.quality && rank[this.quality.qualityBucket] > rank[stats.qualityBucket] ? this.quality.qualityBucket : stats.qualityBucket;
        this.quality = { relayed: !!stats.relayed || !!this.quality?.relayed, qualityBucket };
        this.options.onStats?.({ rttMs: stats.rttMs, jitterMs: stats.jitterMs, lossPct: stats.lossPct, relayed: !!stats.relayed, qualityBucket: stats.qualityBucket });
      },
      onIce: (candidate, attempt) => {
        if (!current()) return;
        const body: CallBody = candidate
          ? {
              ...this.base(attempt),
              t: 'ice',
              cand: candidate.candidate ?? '',
              mid: candidate.sdpMid ?? null,
              mline: candidate.sdpMLineIndex ?? null,
              ufrag: candidate.usernameFragment ?? '',
            }
          : { ...this.base(attempt), t: 'ice-end' };
        void this.send(target, body).catch(() => {});
      },
      onConnectionState: (value, attempt) => {
        if (!current() || this.state.phase === 'IDLE' || this.state.phase === 'ENDED') return;
        if (this.state.role === 'caller' && this.state.winnerDeviceId !== target) return;
        const type =
          value === 'connected'
            ? 'MEDIA_CONNECTED'
            : value === 'disconnected'
              ? 'MEDIA_DISCONNECTED'
              : value === 'failed'
                ? 'MEDIA_FAILED'
                : null;
        if (type) void this.dispatch({ type, callId: this.call!.id, attempt });
      },
      onError: () => {
        if (current() && this.state.phase !== 'IDLE' && this.state.phase !== 'ENDED')
          void this.dispatch({
            type: 'MEDIA_ERROR',
            callId: this.call!.id,
            attempt: this.state.attempt,
          });
      },
    });
    this.media.set(target, media);
    media.setMuted(this.muted);
    return media;
  }
  private offering = new Map<string, Promise<void>>();
  private async offerTarget(target: string, attempt: number, generation: number) {
    const previous = this.offering.get(target);
    if (previous) await previous;
    if (generation !== this.generation || !this.busy || this.state.phase === 'IDLE' ||
      this.state.attempt !== attempt || (this.state.winnerDeviceId && this.state.winnerDeviceId !== target)) return;
    const operation = this.buildOffer(target, attempt, generation);
    this.offering.set(target, operation);
    try { await operation; }
    finally { if (this.offering.get(target) === operation) this.offering.delete(target); }
  }
  private async buildOffer(target: string, attempt: number, generation: number) {
    this.outgoingOffers.delete(target);
    await this.media.get(target)?.close();
    if (generation !== this.generation || !this.busy) return;
    this.media.delete(target);
    this.ready.delete(target);
    this.candidates.delete(target);
    const media = this.newMedia(target);
    const sdp = await media.startOutgoing(this.ice, attempt);
    if (generation !== this.generation || !this.busy || this.media.get(target) !== media) {
      await media.close(); return;
    }
    try {
      const offer = { ...this.base(attempt), t: 'offer' as const, media: 'audio' as const, sdp, ts: Date.now() };
      this.outgoingOffers.set(target, offer);
      await this.send(target, offer);
    } catch (error) {
      const state = this.state;
      // A valid answer can retire this fork or supersede its negotiation while
      // the earlier send is still checking live endpoint authorization.
      if (generation !== this.generation || state.phase === 'IDLE' || state.phase === 'ENDED' ||
        state.attempt !== attempt || (state.winnerDeviceId && state.winnerDeviceId !== target) ||
        this.media.get(target) !== media) return;
      // No RAM offline queue. Discard this negotiation and await an authenticated ready hint.
      if (state.phase === 'DIALING') {
        this.outgoingOffers.delete(target);
        this.media.delete(target);
        await media.close();
        return;
      }
      throw error;
    }
  }
  private async flush(target: string) {
    const generation = this.generation;
    const media = this.media.get(target);
    const candidates = this.candidates.get(target) ?? [];
    this.candidates.delete(target);
    this.ready.add(target);
    for (const candidate of candidates) {
      if (generation !== this.generation || !this.busy || this.media.get(target) !== media) return;
      await media?.addIce(candidate);
    }
  }
  private async effect(effect: MachineEffect, generation: number) {
    const state = this.state;
    if (effect.type === 'START_TIMER') {
      const previous = this.timers.get(effect.timer);
      if (previous) clearTimeout(previous);
      const callId = 'callId' in state ? state.callId : '';
      this.timers.set(
        effect.timer,
        setTimeout(() => {
          if (generation === this.generation)
            void this.dispatch({
              type: 'TIMER',
              timer: effect.timer,
              callId,
              attempt: effect.attempt,
            });
        }, effect.ms),
      );
      return;
    }
    if (effect.type === 'STOP_TIMER') {
      clearTimeout(this.timers.get(effect.timer));
      this.timers.delete(effect.timer);
      return;
    }
    if (effect.type === 'STOP_TIMERS') {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      return;
    }
    if (effect.type === 'STOP_RING') return;
    if (effect.type === 'CLOSE_MEDIA') {
      await this.cleanup;
      return;
    }
    if (effect.type === 'REPORT_END') {
      if (this.call) this.ended.add(this.call.id);
      if (this.ended.size > 256) this.ended.delete(this.ended.values().next().value!);
      this.options.onEnded?.(effect.reason);
      return;
    }
    if (effect.type === 'CREATE_CALL') {
      try {
        const result = await this.options.api.create(this.linkId);
        if (generation !== this.generation || !this.busy) {
          await this.options.api.end(result.callId, 'cancelled');
          return;
        }
        if (result.call.id !== result.callId || result.call.linkId !== this.linkId) throw new Error('CALL_CREATE_MISMATCH');
        this.call = result.call;
        this.ice = result.iceServers;
        this.targets = result.calleeDevices.map((d) => d.id);
        try {
          await this.options.transport.admit?.(result.callId, result.call);
        } catch (error) {
          await this.options.api.end(result.callId, 'failed').catch(() => {});
          this.options.transport.retire?.(result.callId);
          throw error;
        }
        if (generation !== this.generation || !this.busy) {
          this.options.transport.retire?.(result.callId);
          return;
        }
        await this.dispatch({
          type: 'CREATED',
          callId: result.callId,
          peerDeviceId: this.targets[0] ?? '',
          ringRemainingMs: Date.parse(result.call.ringExpiresAt) - Date.now(),
        });
      } catch (e) {
        if (generation === this.generation)
          await this.dispatch({
            type: 'CREATE_FAILED',
            code:
              (e as { response?: { data?: { code?: string } } }).response?.data?.code ===
              'PEER_BUSY'
                ? 'PEER_BUSY'
                : 'UNAVAILABLE',
          });
      }
      return;
    }
    if (!this.call || state.phase === 'IDLE') return;
    if (effect.type === 'END_CALL') {
      await this.options.api.end(this.call.id, toEndInputReason(effect.reason));
      return;
    }
    if (effect.type === 'DECLINE_CALL') {
      await this.options.api.decline(this.call.id);
      return;
    }
    if (effect.type === 'SEND_HANGUP') {
      await Promise.allSettled(
        this.targets.map((target) =>
          this.send(target, {
            ...this.base(state.attempt),
            t: 'hangup',
            reason: effect.reason,
            ts: Date.now(),
          }),
        ),
      );
      return;
    }
    if (effect.type === 'RECONCILE') {
      await this.reconcile();
      return;
    }
    if (effect.type === 'CLAIM_ANSWER') {
      const callId = this.call.id;
      try {
        const result = await this.options.api.answer(callId);
        if (generation !== this.generation || !this.busy) {
          // A local decline can race an in-flight answer transaction. If this
          // account's live manager won anyway, terminate that captured call ID;
          // never capture or mutate the replacement session. Logout disables
          // this manager, so it cannot write with a replacement account.
          if (this.enabled && result.call.answeredDeviceId === this.options.localDeviceId)
            await this.options.api.end(callId, 'cancelled');
          return;
        }
        this.call = result.call;
        this.ice = result.iceServers;
        await this.dispatch({
          type: 'CLAIMED',
          callId: this.call.id,
          answeredDeviceId: result.call.answeredDeviceId ?? '',
        });
      } catch (error) {
        if (generation !== this.generation || !this.busy) return;
        const code = (error as { response?: { data?: { code?: string } } }).response?.data?.code;
        await this.dispatch({ type: 'CLAIM_FAILED', callId, reason: code === 'ANSWERED_ELSEWHERE' ? 'answered-elsewhere' : 'unavailable' });
      }
      return;
    }
    if (effect.type === 'SEND_NEEDS_OFFER') {
      await this.options.prepareMedia?.();
      if (generation !== this.generation || !this.busy) {
        await this.options.releaseMedia?.();
        return;
      }
      await this.send(state.peerDeviceId, {
        ...this.base(effect.attempt),
        t: 'answer',
        needsOffer: true,
        ts: Date.now(),
      });
      return;
    }
    if (effect.type === 'START_OUTGOING') {
      await this.options.prepareMedia?.();
      if (generation !== this.generation || !this.busy) {
        await this.options.releaseMedia?.();
        return;
      }
      const targets = state.winnerDeviceId ? [state.winnerDeviceId] : this.targets.slice(0, 2);
      for (const target of targets) {
        if (generation !== this.generation || !this.busy) return;
        if (this.state.phase !== 'IDLE' && this.state.phase !== 'ENDED' &&
          this.state.winnerDeviceId && this.state.winnerDeviceId !== target) continue;
        await this.offerTarget(target, effect.attempt, generation);
      }
      return;
    }
    if (effect.type === 'ACCEPT_OFFER') {
      const offer = this.offers.get(state.peerDeviceId);
      if (!offer || offer.attempt !== effect.attempt) return;
      await this.options.prepareMedia?.();
      if (generation !== this.generation || !this.busy) {
        await this.options.releaseMedia?.();
        return;
      }
      let media = this.media.get(state.peerDeviceId);
      if (!media) media = this.newMedia(state.peerDeviceId);
      const sdp = await media.acceptOffer(offer.sdp, this.ice, effect.attempt);
      if (generation !== this.generation || !this.busy) {
        await media.close();
        return;
      }
      await this.flush(state.peerDeviceId);
      if (generation !== this.generation || !this.busy || this.media.get(state.peerDeviceId) !== media) return;
      await this.send(state.peerDeviceId, {
        ...this.base(effect.attempt),
        t: 'answer',
        sdp,
        ts: Date.now(),
      });
      return;
    }
    if (effect.type === 'APPLY_ANSWER') {
      const answer = this.answers.get(state.peerDeviceId);
      const media = this.media.get(state.peerDeviceId);
      if (answer?.sdp && media) {
        await media.setRemoteAnswer(answer.sdp);
        if (generation !== this.generation || !this.busy || this.media.get(state.peerDeviceId) !== media) return;
        await this.flush(state.peerDeviceId);
      }
      return;
    }
    if (effect.type === 'RESTART_ICE') {
      const result = await this.options.api.ice(this.call.id);
      if (generation !== this.generation || !this.busy) return;
      this.ice = result.iceServers;
      this.ready.delete(state.peerDeviceId);
      const sdp = await this.media.get(state.peerDeviceId)?.restartIce(this.ice, effect.attempt);
      if (sdp && generation === this.generation && this.busy)
        await this.send(state.peerDeviceId, {
          ...this.base(effect.attempt),
          t: 'offer',
          media: 'audio',
          sdp,
          ts: Date.now(),
        });
    }
  }
}

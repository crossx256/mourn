import type { QualityBucket } from '../types';

export interface CallStats {
  rttMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
  relayed: boolean;
  qualityBucket: QualityBucket;
}
export interface BrowserMediaEvents {
  onIce(candidate: RTCIceCandidateInit | null, attempt: number): void;
  onConnectionState(state: RTCPeerConnectionState, attempt: number): void;
  onError(code: string): void;
  onStats(stats: CallStats): void;
}
export interface BrowserMediaOptions {
  alwaysRelay: boolean;
  micDeviceId?: string;
  events: BrowserMediaEvents;
}
interface MediaDependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
  getAudioCapabilities(): RTCRtpCapabilities | null;
  createAudio(): HTMLAudioElement;
  createStream(tracks: MediaStreamTrack[]): MediaStream;
}
export function browserMediaSupport(): { available: boolean; code?: string } {
  return typeof RTCPeerConnection !== 'undefined' && typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    ? { available: true } : { available: false, code: 'UNAVAILABLE' };
}
const browserDependencies = (): MediaDependencies => ({
  getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
  createPeerConnection: config => new RTCPeerConnection(config),
  getAudioCapabilities: () => RTCRtpReceiver.getCapabilities('audio'),
  createAudio: () => document.createElement('audio'),
  createStream: tracks => new MediaStream(tracks),
});
const errorCode = (error: unknown): string => error instanceof Error && error.name === 'NotAllowedError'
  ? 'MICROPHONE_DENIED' : error instanceof Error && error.name === 'NotFoundError' ? 'MICROPHONE_UNAVAILABLE' : 'MEDIA_FAILED';

/** One peer per instance. SDP/fingerprints must arrive through authenticated Vault signalling. */
export class BrowserMedia {
  readonly kind = 'browser' as const;
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private closed = false;
  private attempt = 1;
  private muted = false;
  private pendingIce: (RTCIceCandidateInit | null)[] = [];
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private statsPending = false;
  private deps: MediaDependencies;

  constructor(private options: BrowserMediaOptions, deps?: MediaDependencies) {
    // Constructing an incoming call must neither prompt nor capture audio.
    this.deps = deps ?? browserDependencies();
  }
  private current(): RTCPeerConnection {
    if (this.closed || !this.pc) throw new Error('MEDIA_CLOSED');
    return this.pc;
  }
  private async prepare(iceServers: RTCIceServer[], attempt: number, offer?: string): Promise<RTCPeerConnection> {
    if (this.closed || this.pc) throw new Error('MEDIA_ALREADY_STARTED');
    this.attempt = attempt;
    try {
      const pc = this.deps.createPeerConnection({ iceServers, iceTransportPolicy: this.options.alwaysRelay ? 'relay' : 'all', bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceCandidatePoolSize: 0 });
      this.pc = pc;
      pc.onicecandidate = event => {
        if (this.closed || pc !== this.pc) return;
        const candidate = event.candidate;
        if (candidate && this.options.alwaysRelay && !/\btyp relay\b/.test(candidate.candidate)) return;
        this.options.events.onIce(candidate ? candidate.toJSON() : null, this.attempt);
      };
      pc.onconnectionstatechange = () => {
        if (!this.closed && pc === this.pc) this.options.events.onConnectionState(pc.connectionState, this.attempt);
      };
      pc.ontrack = event => {
        if (this.closed || event.track.kind !== 'audio') return;
        const audio = this.audio ??= this.deps.createAudio();
        audio.autoplay = true;
        audio.srcObject = event.streams[0] ?? this.deps.createStream([event.track]);
        void audio.play().catch(() => { if (!this.closed) this.options.events.onError('AUDIO_PLAYBACK_BLOCKED'); });
      };
      const stream = await this.deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000, ...(this.options.micDeviceId ? { deviceId: { exact: this.options.micDeviceId } } : {}) }, video: false });
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); throw new Error('MEDIA_CLOSED'); }
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('MICROPHONE_UNAVAILABLE');
      track.enabled = !this.muted;
      track.onended = () => { if (!this.closed) this.options.events.onError('MICROPHONE_ENDED'); };
      // An answerer must attach capture to the offered transceiver. Adding a new
      // one before applying the offer can leave it unassociated and send no audio.
      if (offer) await pc.setRemoteDescription({ type: 'offer', sdp: offer });
      this.current();
      const offered = offer ? pc.getTransceivers?.().find(item => item.receiver.track.kind === 'audio') : undefined;
      const transceiver = offered ?? pc.addTransceiver(track, { direction: 'sendrecv', streams: [stream] });
      if (offered) {
        offered.direction = 'sendrecv';
        await offered.sender.replaceTrack(track);
        offered.sender.setStreams(stream);
      }
      const opus = this.deps.getAudioCapabilities()?.codecs.filter(codec => codec.mimeType.toLowerCase() === 'audio/opus') ?? [];
      if (!opus.length || typeof transceiver.setCodecPreferences !== 'function') throw new Error('OPUS_UNAVAILABLE');
      transceiver.setCodecPreferences(opus);
      const params = transceiver.sender.getParameters();
      if (params.encodings?.length) {
        params.encodings.forEach(encoding => { encoding.maxBitrate = 32_000; });
        await transceiver.sender.setParameters(params);
      }
      this.current();
      this.statsTimer = setInterval(() => {
        if (this.closed || this.statsPending) return;
        this.statsPending = true;
        void this.getStats().then(stats => { if (!this.closed) this.options.events.onStats(stats); }).catch(() => {}).finally(() => { this.statsPending = false; });
      }, 2000);
      return pc;
    } catch (error) {
      await this.close();
      throw new Error(errorCode(error));
    }
  }
  private async local(description: RTCSessionDescriptionInit): Promise<string> {
    const pc = this.current();
    await pc.setLocalDescription(description);
    this.current();
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error('SDP_UNAVAILABLE');
    return sdp;
  }
  async startOutgoing(iceServers: RTCIceServer[], attempt: number): Promise<string> {
    try {
      const pc = await this.prepare(iceServers, attempt);
      return await this.local(await pc.createOffer());
    } catch (error) { await this.close(); throw error; }
  }
  async acceptOffer(sdp: string, iceServers: RTCIceServer[], attempt: number): Promise<string> {
    try {
      const existing = this.pc;
      const pc = existing ?? await this.prepare(iceServers, attempt, sdp);
      this.current(); this.attempt = attempt;
      if (existing) await pc.setRemoteDescription({ type: 'offer', sdp });
      await this.flushIce();
      return await this.local(await pc.createAnswer());
    } catch (error) { await this.close(); throw error; }
  }
  async setRemoteAnswer(sdp: string): Promise<void> {
    try {
      await this.current().setRemoteDescription({ type: 'answer', sdp });
      this.current();
      await this.flushIce();
    } catch (error) { await this.close(); throw error; }
  }
  async addIce(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (this.closed) return;
    if (candidate && this.options.alwaysRelay && !/\btyp relay\b/.test(candidate.candidate ?? '')) return;
    if (!this.pc?.remoteDescription) {
      if (this.pendingIce.length >= 256) throw new Error('ICE_QUEUE_FULL');
      this.pendingIce.push(candidate); return;
    }
    await this.current().addIceCandidate(candidate);
  }
  private async flushIce(): Promise<void> {
    const candidates = this.pendingIce.splice(0);
    for (const candidate of candidates) await this.current().addIceCandidate(candidate);
  }
  async restartIce(iceServers?: RTCIceServer[], attempt = this.attempt + 1): Promise<string> {
    try {
      const pc = this.current(); this.attempt = attempt;
      if (iceServers) pc.setConfiguration({ ...pc.getConfiguration(), iceServers });
      pc.restartIce();
      return await this.local(await pc.createOffer({ iceRestart: true }));
    } catch (error) { await this.close(); throw error; }
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
  }
  async setOutputDevice(id: string): Promise<void> {
    this.current();
    const audio = this.audio ??= this.deps.createAudio();
    if (typeof audio.setSinkId !== 'function') throw new Error('AUDIO_ROUTING_UNAVAILABLE');
    await audio.setSinkId(id);
  }
  async setSpeaker(_on: boolean): Promise<void> {
    void _on;
    // Browsers cannot select earpiece vs speaker. Android owns this through AudioManager.
    throw new Error('AUDIO_ROUTING_UNAVAILABLE');
  }
  async getStats(): Promise<CallStats> {
    const report = await this.current().getStats();
    let rttMs: number | null = null; let jitterMs: number | null = null;
    let lost = 0; let received = 0; let relayed = false;
    const candidatePairs: RTCStats[] = [];
    report.forEach(row => {
      if (row.type === 'inbound-rtp' && (row.kind === 'audio' || row.mediaType === 'audio')) {
        lost += Math.max(0, Number(row.packetsLost) || 0); received += Math.max(0, Number(row.packetsReceived) || 0);
        if (Number.isFinite(row.jitter)) jitterMs = row.jitter * 1000;
      }
      if (row.type === 'remote-inbound-rtp' && Number.isFinite(row.roundTripTime)) rttMs = row.roundTripTime * 1000;
      if (row.type === 'candidate-pair' && (row.nominated || row.selected) && row.state === 'succeeded') candidatePairs.push(row);
    });
    for (const row of candidatePairs) {
      const pair = row as RTCIceCandidatePairStats;
      relayed ||= report.get(pair.localCandidateId)?.candidateType === 'relay' || report.get(pair.remoteCandidateId)?.candidateType === 'relay';
      if (rttMs === null && typeof pair.currentRoundTripTime === 'number') rttMs = pair.currentRoundTripTime * 1000;
    }
    const lossPct = lost + received > 0 ? lost / (lost + received) * 100 : null;
    const qualityBucket: QualityBucket = (lossPct ?? 0) > 5 || (rttMs ?? 0) > 500 || (jitterMs ?? 0) > 80 ? 'poor'
      : (lossPct ?? 0) > 2 || (rttMs ?? 0) > 250 || (jitterMs ?? 0) > 30 ? 'fair' : 'good';
    return { rttMs, jitterMs, lossPct, relayed, qualityBucket };
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.statsTimer); this.pendingIce = [];
    if (this.pc) {
      this.pc.onicecandidate = null; this.pc.onconnectionstatechange = null; this.pc.ontrack = null;
      this.pc.close(); this.pc = null;
    }
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = null;
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; this.audio.removeAttribute('src'); this.audio = null; }
  }
}

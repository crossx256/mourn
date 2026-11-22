import { describe, it, expect, vi } from 'vitest';
import { BrowserMedia, browserMediaSupport } from '../../src/calls/media/browserMedia';

const SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-ufrag:remote1\r\n';
function boundary() {
  const track = { enabled: true, readyState: 'live', kind: 'audio', stop: vi.fn(), onended: null };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const sender = { getParameters: () => ({ encodings: [{}] }), setParameters: vi.fn(async () => {}), replaceTrack: vi.fn(async () => {}) };
  const transceiver = { sender, setCodecPreferences: vi.fn() };
  const pc = {
    addTransceiver: vi.fn(() => transceiver), close: vi.fn(), setConfiguration: vi.fn(), getConfiguration: () => ({ iceServers: [] }), restartIce: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: SDP.replace('remote1', 'local1') })), createAnswer: vi.fn(async () => ({ type: 'answer', sdp: SDP.replace('remote1', 'local1') })),
    setLocalDescription: vi.fn(async (s: unknown) => { pc.localDescription = s; }),
    setRemoteDescription: vi.fn(async (s: unknown) => { pc.remoteDescription = s; pc.signalingState = (s as {type:string}).type === 'offer' ? 'have-remote-offer' : 'stable'; }),
    addIceCandidate: vi.fn(async () => {}), getStats: vi.fn(async () => new Map()),
    localDescription: null as unknown, remoteDescription: null as unknown, signalingState: 'stable', connectionState: 'new', iceGatheringState: 'complete',
    onicecandidate: null as null | ((e: unknown) => void), onconnectionstatechange: null as null | (() => void), ontrack: null as null | ((e: unknown) => void),
  };
  const audio = { srcObject: null as unknown, autoplay: false, play: vi.fn(async () => {}), pause: vi.fn(), removeAttribute: vi.fn(), setSinkId: vi.fn(async () => {}) };
  const deps = {
    getUserMedia: vi.fn(async () => stream as unknown as MediaStream),
    createPeerConnection: vi.fn(() => pc as unknown as RTCPeerConnection),
    getAudioCapabilities: vi.fn(() => ({ codecs: [{ mimeType: 'audio/PCMU', clockRate: 8000 }, { mimeType: 'audio/opus', clockRate: 48000, channels: 2 }], headerExtensions: [] })),
    createAudio: vi.fn(() => audio as unknown as HTMLAudioElement),
    createStream: vi.fn(() => stream as unknown as MediaStream), now: () => 100,
  };
  const events = { onIce: vi.fn(), onConnectionState: vi.fn(), onError: vi.fn(), onStats: vi.fn() };
  return { track, stream, pc, transceiver, sender, audio, deps, events };
}
describe('browser media boundary', () => {
  it('is SSR safe and explicitly unavailable without browser APIs', () => {
    expect(browserMediaSupport()).toEqual({ available: false, code: 'UNAVAILABLE' });
  });
  it('uses only supplied ICE, exactly one Opus audio transceiver and user capture', async () => {
    const b = boundary(); const media = new BrowserMedia({ alwaysRelay: true, micDeviceId: 'mic', events: b.events }, b.deps);
    expect(b.deps.getUserMedia).not.toHaveBeenCalled();
    expect(await media.startOutgoing([{ urls: 'turn:relay.invalid', username: 'test', credential: 'test' }], 1)).toContain('v=0');
    expect(b.deps.createPeerConnection).toHaveBeenCalledWith({ iceServers: [{ urls: 'turn:relay.invalid', username: 'test', credential: 'test' }], iceTransportPolicy: 'relay', bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceCandidatePoolSize: 0 });
    expect(b.deps.getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000, deviceId: { exact: 'mic' } }, video: false });
    expect(b.pc.addTransceiver).toHaveBeenCalledExactlyOnceWith(b.track, { direction: 'sendrecv', streams: [b.stream] });
    expect(b.transceiver.setCodecPreferences).toHaveBeenCalledWith([{ mimeType: 'audio/opus', clockRate: 48000, channels: 2 }]);
    expect(b.sender.setParameters).toHaveBeenCalledWith({ encodings: [{ maxBitrate: 32000 }] });
    expect(b.events.onConnectionState).not.toHaveBeenCalledWith('connected', expect.anything());
    await media.close();
    expect(b.track.stop).toHaveBeenCalledTimes(1);
  });
  it('queues early candidates and never applies non-relay candidates in relay mode', async () => {
    const b = boundary(); const media = new BrowserMedia({ alwaysRelay: true, events: b.events }, b.deps);
    const relay = { candidate: 'candidate:1 1 udp 1 192.0.2.1 1234 typ relay', sdpMid: '0' };
    await media.addIce({ candidate: 'candidate:2 1 udp 1 192.0.2.2 1234 typ host', sdpMid: '0' });
    await media.addIce(relay); await media.addIce(null);
    expect(b.pc.addIceCandidate).not.toHaveBeenCalled();
    await media.acceptOffer(SDP, [], 1);
    expect(b.pc.addIceCandidate.mock.calls).toEqual([[relay], [null]]);
    await media.close();
  });
  it('stops permission results that arrive after hangup and closes idempotently', async () => {
    const b = boundary(); let grant!: (s: MediaStream) => void;
    b.deps.getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
    const media = new BrowserMedia({ alwaysRelay: false, events: b.events }, b.deps);
    const starting = media.startOutgoing([], 1);
    await media.close(); grant(b.stream as unknown as MediaStream);
    await expect(starting).rejects.toThrow(); await media.close();
    expect(b.track.stop).toHaveBeenCalledTimes(1);
    expect(b.pc.close).toHaveBeenCalledTimes(1);
    expect(b.pc.addTransceiver).not.toHaveBeenCalled();
  });
  it('closes capture after negotiation failure', async () => {
    const b = boundary(); b.pc.createOffer.mockRejectedValue(new Error('negotiation'));
    const media = new BrowserMedia({ alwaysRelay: false, events: b.events }, b.deps);
    await expect(media.startOutgoing([], 1)).rejects.toThrow();
    expect(b.track.stop).toHaveBeenCalledTimes(1);
    expect(b.pc.close).toHaveBeenCalledTimes(1);
  });
  it('closes capture and timers if applying a remote answer fails', async () => {
    const b = boundary();
    const media = new BrowserMedia({ alwaysRelay: false, events: b.events }, b.deps);
    await media.startOutgoing([], 1);
    b.pc.setRemoteDescription.mockRejectedValueOnce(new Error('invalid answer'));
    await expect(media.setRemoteAnswer(SDP)).rejects.toThrow('invalid answer');
    expect(b.track.stop).toHaveBeenCalledTimes(1);
    expect(b.pc.close).toHaveBeenCalledTimes(1);
  });
  it('closes capture if ICE restart negotiation fails', async () => {
    const b = boundary();
    const media = new BrowserMedia({ alwaysRelay: false, events: b.events }, b.deps);
    await media.startOutgoing([], 1);
    b.pc.createOffer.mockRejectedValueOnce(new Error('restart failed'));
    await expect(media.restartIce()).rejects.toThrow('restart failed');
    expect(b.track.stop).toHaveBeenCalledTimes(1);
    expect(b.pc.close).toHaveBeenCalledTimes(1);
  });
  it('preserves muted state, restarts with rotated credentials and tears down remote audio', async () => {
    const b = boundary(); const media = new BrowserMedia({ alwaysRelay: false, events: b.events }, b.deps);
    media.setMuted(true); await media.startOutgoing([], 1); expect(b.track.enabled).toBe(false);
    media.setMuted(false); expect(b.track.enabled).toBe(true);
    await media.restartIce([{ urls: 'turn:new.invalid' }], 2);
    expect(b.pc.setConfiguration).toHaveBeenCalledWith({ iceServers: [{ urls: 'turn:new.invalid' }] });
    expect(b.pc.restartIce).toHaveBeenCalledTimes(1);
    b.pc.ontrack?.({ track: b.track, streams: [b.stream] });
    await media.close(); expect(b.audio.pause).toHaveBeenCalledOnce(); expect(b.audio.srcObject).toBeNull();
  });
  it('returns only aggregate quality data, never candidate addresses', async () => {
    const b = boundary(); b.pc.getStats.mockResolvedValue(new Map([
      ['in', { type: 'inbound-rtp', kind: 'audio', packetsLost: 10, packetsReceived: 90, jitter: 0.1 }],
      ['pair', { type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'local', remoteCandidateId: 'remote', currentRoundTripTime: 0.2 }],
      ['local', { type: 'local-candidate', candidateType: 'relay', address: '192.0.2.1' }],
    ]));
    const media = new BrowserMedia({ alwaysRelay: false, events: b.events }, b.deps);
    await media.startOutgoing([], 1);
    expect(await media.getStats()).toEqual({ rttMs: 200, jitterMs: 100, lossPct: 10, relayed: true, qualityBucket: 'poor' });
    await media.close();
  });
});

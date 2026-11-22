import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ServerCall } from '../../src/calls/types';
const f = vi.hoisted(() => ({
  options: {} as Record<string, any>,
  api: { config: vi.fn(), active: vi.fn(), ready: vi.fn(async () => {}), get: vi.fn(), create: vi.fn(), answer: vi.fn(), end: vi.fn(), decline: vi.fn(), ice: vi.fn(), history: vi.fn(), clearHistory: vi.fn() },
  native: { setIncomingEnabled: vi.fn(async () => {}), resetCallState: vi.fn(async () => {}), requestMicPermission: vi.fn(async () => ({ granted: true })), startCallService: vi.fn(async () => {}), stopCallService: vi.fn(async () => {}), cancelIncoming: vi.fn(async () => {}), showIncoming: vi.fn(async () => ({ shown: true })), setMuted: vi.fn(async () => {}), setAudioRoute: vi.fn(async () => {}) },
  media: { startOutgoing: vi.fn(async () => 'offer'), acceptOffer: vi.fn(async () => 'answer'), setRemoteAnswer: vi.fn(async () => {}), addIce: vi.fn(async () => {}), restartIce: vi.fn(async () => 'restart'), setMuted: vi.fn(), close: vi.fn(async () => {}) },
}));
vi.mock('src/calls/api', () => ({ callsApi: f.api }));
vi.mock('src/calls/android', () => ({ AndroidCalls: f.native, isAndroidCallsPlatform: () => true }));
vi.mock('src/utils/platform', () => ({ mobilePlatform: () => 'android' }));
vi.mock('src/calls/media/browserMedia', () => ({ browserMediaSupport: () => ({ available: true }), BrowserMedia: class { constructor(options: Record<string, any>) { f.options = options; return { ...f.media }; } } }));
import { setCallTransport, useCallsStore } from '../../src/stores/calls';
const incoming = (): ServerCall => ({ id: 'call', linkId: 'link', callerId: 'peer', calleeId: 'me', callerDeviceId: 'remote', answeredDeviceId: null, state: 'RINGING', ringExpiresAt: new Date(Date.now() + 60000).toISOString() }) as ServerCall;
let store: ReturnType<typeof useCallsStore>;
beforeEach(() => {
  vi.clearAllMocks();
  f.api.config.mockResolvedValue({ enabled: true, protocolVersion: 1, signallingPolicy: 'memory-only-v1' });
  f.api.active.mockResolvedValue([]);
  f.api.get.mockReset().mockImplementation(async () => incoming());
  setActivePinia(createPinia());
  store = useCallsStore();
  setCallTransport({ send: async () => {} });
});
afterEach(async () => { await store.destroy(); setCallTransport(null); });
describe('calls store lifecycle', () => {
  it('keeps new dialing disabled until interrupted-call cleanup finishes', async () => {
    await store.initialize('me', 'local');
    expect(store.ready).toBe(false);
    expect(store.canCall).toBe(false);
    let finish!: (rows: ServerCall[]) => void;
    f.api.active.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const cleaning = store.discardInterruptedCalls();
    await vi.waitFor(() => expect(f.api.active).toHaveBeenCalled());
    expect(store.canCall).toBe(false);
    finish([]);
    await cleaning;
    expect(store.ready).toBe(true);
    expect(store.canCall).toBe(true);
  });
  it('finishes cold startup and restores a fresh ring after rejecting a stale ring', async () => {
    const stale = { ...incoming(), id: 'before-boot' };
    const fresh = incoming();
    setCallTransport({
      admit: async id => { if (id === stale.id) throw new Error('CALL_FRESH_RING_REQUIRED'); },
      send: async () => {},
    });
    await store.initialize('me', 'local');
    f.api.active.mockResolvedValueOnce([stale, fresh]);
    await store.discardInterruptedCalls();
    expect(store.ready).toBe(true);
    expect(store.call?.id).toBe(fresh.id);
    expect(f.api.ready.mock.calls).toEqual([[fresh.id]]);
    expect(f.api.answer).not.toHaveBeenCalled();
    expect(f.native.requestMicPermission).not.toHaveBeenCalled();
  });
  it('does not acknowledge a signal before a manager exists', async () => {
    await expect(store.receiveSignal({ mc: 1, kind: 'call', cid: 'call', dev: 'remote', t: 'ice-end', attempt: 1 })).rejects.toThrow('CALL_MANAGER_UNAVAILABLE');
  });
  it('requires the explicit memory-only signalling policy', async () => {
    f.api.config.mockResolvedValueOnce({ enabled: true, protocolVersion: 1 });
    await store.initialize('me', 'local');
    expect(store.enabled).toBe(false);
  });
  it('propagates authenticated signal handler failures instead of acknowledging them', async () => {
    await store.initialize('me', 'local');
    f.api.get.mockRejectedValueOnce(new Error('SIGNAL_LOOKUP_FAILED'));
    await expect(store.receiveSignal({ mc: 1, kind: 'call', cid: 'call', dev: 'remote', t: 'offer', attempt: 1, media: 'audio', sdp: 'offer', ts: Date.now() })).rejects.toThrow('SIGNAL_LOOKUP_FAILED');
  });
  it('preserves cold-start native actions until authenticated config is ready', async () => {
    let resume!: (config: object) => void;
    f.api.config.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
    const pending = store.initialize('me', 'local');
    await vi.waitFor(() => expect(f.api.config).toHaveBeenCalled());
    expect(f.native.resetCallState).not.toHaveBeenCalled();
    expect(f.native.setIncomingEnabled).not.toHaveBeenCalled();
    resume({ enabled: true, protocolVersion: 1, signallingPolicy: 'memory-only-v1' });
    await pending;
    expect(f.native.setIncomingEnabled).toHaveBeenCalledWith({ enabled: true, ringtone: 'system', vibrate: true });
  });
  it('resets native state only on explicit account teardown, after media closes', async () => {
    await store.initialize('me', 'local');
    await store.receiveIncoming('call');
    f.api.answer.mockResolvedValue({ call: { ...incoming(), state: 'ACTIVE', answeredDeviceId: 'local' }, iceServers: [] });
    await store.receiveSignal({ mc: 1, kind: 'call', cid: 'call', dev: 'remote', t: 'offer', attempt: 1, media: 'audio', sdp: 'offer', ts: Date.now() });
    await store.accept();
    await store.destroy({ accountBoundary: true });
    expect(f.native.resetCallState).toHaveBeenCalledTimes(1);
    expect(f.media.close.mock.invocationCallOrder[0]).toBeLessThan(f.native.resetCallState.mock.invocationCallOrder[0]!);
  });
  it('resets after local media close without waiting for an obsolete permission prompt', async () => {
    await store.initialize('me', 'local');
    await store.receiveIncoming('call');
    f.api.answer.mockResolvedValue({ call: { ...incoming(), state: 'ACTIVE', answeredDeviceId: 'local' }, iceServers: [] });
    await store.receiveSignal({ mc: 1, kind: 'call', cid: 'call', dev: 'remote', t: 'offer', attempt: 1, media: 'audio', sdp: 'offer', ts: Date.now() });
    let grant!: (value: { granted: boolean }) => void;
    f.native.requestMicPermission.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
    const accepting = store.accept();
    await vi.waitFor(() => expect(f.native.requestMicPermission).toHaveBeenCalled());
    const stopped = store.destroy({ accountBoundary: true });
    await vi.waitFor(() => expect(f.native.resetCallState).toHaveBeenCalled());
    grant({ granted: true });
    await Promise.all([accepting, stopped]);
    expect(f.native.startCallService).not.toHaveBeenCalled();
  });
  it('synchronizes silent and vibration preferences to native eligibility after config', async () => {
    await store.initialize('me', 'local');
    store.setRingtone('silent');
    store.setVibrate(false);
    await vi.waitFor(() => expect(f.native.setIncomingEnabled).toHaveBeenLastCalledWith({ enabled: true, ringtone: 'silent', vibrate: false }));
  });
  it('ignores config refresh when no account manager exists', async () => {
    await store.refreshConfig();
    expect(f.api.config).not.toHaveBeenCalled();
    expect(f.native.setIncomingEnabled).not.toHaveBeenCalled();
  });
  it('enumerates microphones on demand without capturing and discards account-stale results', async () => {
    await store.initialize('me', 'local');
    let resume!: (rows: object[]) => void;
    const enumerateDevices = vi.fn(() => new Promise<object[]>(resolve => { resume = resolve; }));
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices } });
    const loading = store.loadMicrophones();
    await store.initialize('other', 'device');
    resume([{ kind: 'audioinput', deviceId: 'private-id', label: 'Private mic' }]);
    await loading;
    expect(store.microphones).toEqual([]);
    vi.unstubAllGlobals();
  });
  it('keeps microphone selection session-only and passes it to capture', async () => {
    await store.initialize('me', 'local');
    store.setMicrophone('private-device');
    await store.receiveIncoming('call');
    f.api.answer.mockResolvedValue({ call: { ...incoming(), state: 'ACTIVE', answeredDeviceId: 'local' }, iceServers: [] });
    await store.receiveSignal({ mc: 1, kind: 'call', cid: 'call', dev: 'remote', t: 'offer', attempt: 1, media: 'audio', sdp: 'offer', ts: Date.now() });
    await store.accept();
    expect(f.options).toMatchObject({ micDeviceId: 'private-device' });
    await store.destroy();
    expect(store.micDeviceId).toBe('');
  });
  it('reports only aggregate quality at call end and drops late stats', async () => {
    await store.initialize('me', 'local');
    await store.receiveIncoming('call');
    f.api.answer.mockResolvedValue({ call: { ...incoming(), state: 'ACTIVE', answeredDeviceId: 'local' }, iceServers: [] });
    await store.receiveSignal({ mc: 1, kind: 'call', cid: 'call', dev: 'remote', t: 'offer', attempt: 1, media: 'audio', sdp: 'offer', ts: Date.now() });
    await store.accept();
    const events = f.options.events;
    events.onConnectionState('connected', 1);
    await vi.waitFor(() => expect(store.state.phase).toBe('ACTIVE'));
    events.onStats({ rttMs: 600, jitterMs: 90, lossPct: 8, relayed: true, qualityBucket: 'poor', address: 'sensitive' });
    expect(store.stats).toEqual({ rttMs: 600, jitterMs: 90, lossPct: 8, relayed: true, qualityBucket: 'poor' });
    await store.hangup();
    expect(f.api.end).toHaveBeenCalledWith('call', expect.any(String), { relayed: true, qualityBucket: 'poor' });
    events.onStats({ rttMs: 5, jitterMs: 1, lossPct: 0, relayed: false, qualityBucket: 'good' });
    expect(store.stats?.qualityBucket).toBe('poor');
  });
  it('stops capture when the native microphone service stops unexpectedly', async () => {
    await store.initialize('me', 'local');
    await store.receiveIncoming('call');
    f.api.answer.mockResolvedValue({ call: { ...incoming(), state: 'ACTIVE', answeredDeviceId: 'local' }, iceServers: [] });
    await store.receiveSignal({ mc: 1, kind: 'call', cid: 'call', dev: 'remote', t: 'offer', attempt: 1, media: 'audio', sdp: 'offer', ts: Date.now() });
    await store.accept();
    await store.nativeServiceChanged('call', 'stopped');
    expect(f.media.close).toHaveBeenCalled();
    expect(store.busy).toBe(false);
  });
  it('closes an existing ring on terminal server state even after REST access is withdrawn', async () => {
    await store.initialize('me', 'local');
    await store.receiveIncoming('call');
    f.api.get.mockRejectedValueOnce(new Error('CALL_DEVICE_MISMATCH'));
    await store.receiveState('call', { state: 'ENDED', reason: 'link-severed' });
    expect(store.state).toMatchObject({ phase: 'ENDED', reason: 'link-severed' });
    expect(f.api.end).not.toHaveBeenCalled();
  });
  it('does not initialize after a synchronous logout supersedes initialization', async () => {
    const pending = store.initialize('me', 'local');
    await store.destroy();
    await pending;
    expect(store.ready).toBe(false);
    expect(store.enabled).toBe(false);
  });
  it('does not apply an old config response or native eligibility to a replacement account', async () => {
    await store.initialize('me', 'local');
    let resume!: (config: object) => void;
    f.api.config.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
    const pending = store.refreshConfig();
    await store.initialize('other', 'device');
    const count = f.native.setIncomingEnabled.mock.calls.length;
    resume({ enabled: false, protocolVersion: 1, signallingPolicy: 'memory-only-v1' });
    await pending;
    expect(store.enabled).toBe(true);
    expect(f.native.setIncomingEnabled).toHaveBeenCalledTimes(count);
    expect(f.native.resetCallState).toHaveBeenCalledTimes(1);
  });
  it('lets only the latest overlapping config request control eligibility', async () => {
    await store.initialize('me', 'local');
    let resume!: (config: object) => void;
    f.api.config.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
    const first = store.refreshConfig();
    f.api.config.mockResolvedValueOnce({ enabled: false, protocolVersion: 1, signallingPolicy: 'memory-only-v1' });
    await store.refreshConfig();
    resume({ enabled: true, protocolVersion: 1, signallingPolicy: 'memory-only-v1' });
    await first;
    expect(store.enabled).toBe(false);
    expect(f.native.setIncomingEnabled).toHaveBeenLastCalledWith({ enabled: false, ringtone: 'system', vibrate: true });
  });
  it('does not dial a replacement account after the old config request completes', async () => {
    await store.initialize('me', 'local');
    let resume!: (config: object) => void;
    f.api.config.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
    const dialing = store.dial('old-link');
    await store.initialize('other', 'other-device');
    resume({ enabled: true, protocolVersion: 1, signallingPolicy: 'memory-only-v1' });
    await dialing;
    expect(f.api.create).not.toHaveBeenCalled();
    expect(store.state.phase).toBe('IDLE');
  });
  it('stops a losing device from the authenticated state frame even when REST excludes it', async () => {
    await store.initialize('me', 'local');
    await store.receiveIncoming('call');
    f.api.get.mockRejectedValueOnce(new Error('CALL_DEVICE_MISMATCH'));
    await store.receiveState('call', { state: 'ACTIVE', answeredDeviceId: 'sibling' });
    expect(store.state).toMatchObject({ phase: 'ENDED', reason: 'answered-elsewhere' });
    expect(f.native.cancelIncoming).toHaveBeenCalledWith({ callId: 'call' });
    expect(f.api.end).not.toHaveBeenCalled();
  });
  it('mutes on transient focus loss and restores only the user mute choice', async () => {
    await store.initialize('me', 'local');
    await store.receiveIncoming('call');
    f.api.answer.mockResolvedValue({ call: { ...incoming(), state: 'ACTIVE', answeredDeviceId: 'local' }, iceServers: [] });
    await store.receiveSignal({ mc: 1, kind: 'call', cid: 'call', dev: 'remote', t: 'offer', attempt: 1, media: 'audio', sdp: 'offer', ts: Date.now() });
    await store.accept();
    store.audioFocusChanged('loss-transient');
    expect(f.media.setMuted).toHaveBeenLastCalledWith(true);
    expect(store.muted).toBe(false);
    store.toggleMute();
    store.audioFocusChanged('gain');
    expect(f.media.setMuted).toHaveBeenLastCalledWith(true);
    store.toggleMute();
    expect(f.media.setMuted).toHaveBeenLastCalledWith(false);
  });
});

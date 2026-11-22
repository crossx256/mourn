import { describe, it, expect, vi } from 'vitest';
import { CallManager } from '../../src/calls/callManager';
import type { CallBody, CreateResult, ServerCall } from '../../src/calls/types';
import type { ManagerOptions } from '../../src/calls/callManager';
const call = {
  id: 'call',
  linkId: 'link',
  callerId: 'peer',
  calleeId: 'me',
  callerDeviceId: 'remote',
  answeredDeviceId: null,
  state: 'RINGING',
  ringExpiresAt: new Date(Date.now() + 60000).toISOString(),
} as ServerCall;
function setup(overrides: Partial<ManagerOptions> = {}) {
  const media = {
    startOutgoing: vi.fn(async () => 'sdp'),
    acceptOffer: vi.fn(async () => 'answer'),
    setRemoteAnswer: vi.fn(async () => {}),
    addIce: vi.fn(async () => {}),
    restartIce: vi.fn(async () => 'restart'),
    close: vi.fn(async () => {}),
    setMuted: vi.fn(),
  };
  const api = {
    create: vi.fn(),
    answer: vi.fn(async () => ({
      call: { ...call, state: 'ACTIVE', answeredDeviceId: 'local' },
      iceServers: [],
      expiresAt: '',
    })),
    get: vi.fn(async () => call),
    active: vi.fn(async () => []),
    ready: vi.fn(async () => {}),
    ice: vi.fn(async () => ({ iceServers: [], expiresAt: '' })),
    end: vi.fn(async () => {}),
    decline: vi.fn(async () => {}),
  };
  const transport = { send: vi.fn(async () => {}), admit: vi.fn(async (_callId: string) => {}), retire: vi.fn((_callId: string) => {}) };
  const factory = vi.fn(() => ({ ...media }));
  const manager = new CallManager({
    api,
    transport,
    createMedia: factory,
    localDeviceId: 'local',
    userId: 'me',
    ...overrides,
  });
  manager.setEnabled(true);
  return { manager, media, api, transport, factory };
}
const outgoing = { ...call, callerId: 'me', calleeId: 'peer', callerDeviceId: 'local' };
const created = {
  callId: 'call',
  call: outgoing,
  calleeDevices: ['one', 'two', 'three'].map((id) => ({
    id,
    deviceName: null,
    platform: 'UNKNOWN',
    lastSeenAt: '',
  })),
  iceServers: [],
  expiresAt: '',
  settings: { ringSeconds: 60 },
} as CreateResult;
const body = (dev: string, extra: object = {}): CallBody =>
  ({
    mc: 1,
    kind: 'call',
    cid: 'call',
    dev,
    attempt: 1,
    t: 'answer',
    sdp: 'answer',
    ts: Date.now(),
    ...extra,
  }) as CallBody;
describe('call lifecycle regressions', () => {
  it('admits a fresh outgoing call before creating media or sending offers', async () => {
    const b = setup(); b.api.create.mockResolvedValue(created);
    let admitted = false;
    b.transport.admit.mockImplementation(async () => { admitted = true; });
    b.factory.mockImplementation(() => { expect(admitted).toBe(true); return { ...b.media }; });
    await b.manager.dial('link');
    expect(b.transport.admit).toHaveBeenCalledWith('call', created.call);
    await b.manager.hangup();
    expect(b.transport.retire).toHaveBeenCalledWith('call');
  });
  it('admits incoming signalling before announcing readiness, without capture', async () => {
    const b = setup(); let admitted = false;
    b.transport.admit.mockImplementation(async () => { admitted = true; });
    b.api.ready.mockImplementation(async () => { expect(admitted).toBe(true); });
    await b.manager.incoming(call);
    expect(b.transport.admit).toHaveBeenCalledWith('call');
    expect(b.factory).not.toHaveBeenCalled();
    await b.manager.decline();
    expect(b.transport.retire).toHaveBeenCalledWith('call');
  });
  it('does not present an incoming ring or capture when session admission fails', async () => {
    const b = setup(); b.transport.admit.mockRejectedValueOnce(new Error('CALL_FRESH_RING_REQUIRED'));
    await expect(b.manager.incoming(call)).rejects.toThrow('CALL_FRESH_RING_REQUIRED');
    expect(b.manager.state.phase).toBe('IDLE');
    expect(b.api.ready).not.toHaveBeenCalled();
    expect(b.factory).not.toHaveBeenCalled();
  });
  it('discards only interrupted calls owned by this device and restores unaccepted rings', async () => {
    const b = setup();
    b.api.active.mockResolvedValue([
      { ...outgoing, id: 'own-caller', state: 'ACTIVE' },
      { ...call, id: 'own-callee', state: 'ACTIVE', answeredDeviceId: 'local' },
      { ...outgoing, id: 'other-caller', callerDeviceId: 'sibling', state: 'ACTIVE' },
      { ...call, id: 'other-callee', state: 'ACTIVE', answeredDeviceId: 'sibling' },
      call,
    ] as never);
    await b.manager.discardInterruptedCalls();
    expect(b.api.end.mock.calls).toEqual([['own-caller', 'failed'], ['own-callee', 'failed']]);
    expect(b.manager.state).toMatchObject({ phase: 'RINGING', callId: 'call' });
    expect(b.factory).not.toHaveBeenCalled();
    await b.manager.logout();
  });
  it('keeps an already offered peer connection when a ready hint races offer delivery', async () => {
    const b = setup(); b.api.create.mockResolvedValue(created); b.api.get.mockResolvedValue(outgoing);
    await b.manager.dial('link');
    const instances = b.factory.mock.calls.length;
    const closes = b.media.close.mock.calls.length;
    await b.manager.peerReady('call', 'one');
    expect(b.factory).toHaveBeenCalledTimes(instances);
    expect(b.media.close).toHaveBeenCalledTimes(closes);
    expect(b.transport.send).toHaveBeenLastCalledWith('link', 'one', expect.objectContaining({ t: 'offer', sdp: 'sdp', attempt: 1 }));
    await b.manager.logout();
  });
  it('keeps an offline outgoing ring alive and builds fresh media only for an authorized ready device', async () => {
    const b = setup(); b.api.create.mockResolvedValue(created);
    b.transport.send.mockRejectedValue(new Error('CALL_PEER_OFFLINE'));
    await b.manager.dial('link');
    expect(b.manager.busy).toBe(true);
    expect(b.api.end).not.toHaveBeenCalled();
    b.api.get.mockResolvedValue(outgoing);
    b.transport.send.mockResolvedValue(undefined);
    await b.manager.peerReady('call', 'three');
    expect(b.transport.send).toHaveBeenLastCalledWith('link', 'three', expect.objectContaining({ t: 'offer', attempt: 1 }));
    await b.manager.peerReady('call', 'intruder');
    expect(b.transport.send).not.toHaveBeenLastCalledWith('link', 'intruder', expect.anything());
    await b.manager.logout();
  });
  it('does not flush old ICE or send an old answer into a replacement call', async () => {
    const b = setup(); await b.manager.incoming(call);
    await b.manager.signal(body('remote', { t: 'offer', media: 'audio', sdp: 'offer' }));
    await b.manager.signal(body('remote', { t: 'ice-end' }));
    await b.manager.signal(body('remote', { t: 'ice-end' }));
    let resume!: () => void;
    b.media.addIce.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
    const accepting = b.manager.accept();
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
    await b.manager.hangup();
    await b.manager.incoming({ ...call, id: 'replacement' });
    const sent = b.transport.send.mock.calls.length;
    resume(); await accepting;
    expect(b.media.addIce).toHaveBeenCalledTimes(1);
    expect(b.transport.send).toHaveBeenCalledTimes(sent);
    expect(b.manager.call?.id).toBe('replacement');
    await b.manager.logout();
  });
  it('awaits ready publication after ring setup without acquiring a microphone', async () => {
    const b = setup();
    let done!: () => void;
    b.api.ready.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }));
    let settled = false;
    const receiving = b.manager.incoming(call).then(() => { settled = true; });
    await vi.waitFor(() => expect(b.api.ready).toHaveBeenCalledWith('call'));
    expect(b.manager.state.phase).toBe('RINGING');
    expect(b.factory).not.toHaveBeenCalled(); expect(settled).toBe(false);
    done(); await receiving; await b.manager.logout();
  });
  it('rejects failed offer application after closing media instead of acknowledging success', async () => {
    const b = setup(); await b.manager.incoming(call); await b.manager.accept();
    b.media.acceptOffer.mockRejectedValueOnce(new Error('BAD_REMOTE_SDP'));
    await expect(b.manager.signal(body('remote', { t: 'offer', media: 'audio', sdp: 'broken' }))).rejects.toThrow('BAD_REMOTE_SDP');
    expect(b.manager.state.phase).toBe('ENDED');
    await b.manager.logout();
  });
  it('preserves a validated terminal server reason instead of collapsing it to normal', async () => {
    const b = setup();
    await b.manager.incoming(call);
    await b.manager.serverState({ ...call, state: 'ENDED', endReason: 'max-duration' });
    expect(b.manager.state).toMatchObject({ phase: 'ENDED', reason: 'max-duration' });
    expect(b.api.end).not.toHaveBeenCalled();
  });
  it('does not carry a previous call mute into a new session', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    await b.manager.dial('link');
    b.manager.setMuted(true);
    await b.manager.hangup();
    b.media.setMuted.mockClear();
    b.api.create.mockResolvedValue({ ...created, callId: 'new', call: { ...outgoing, id: 'new' } });
    await b.manager.dial('link');
    expect(b.media.setMuted).toHaveBeenLastCalledWith(false);
    await b.manager.logout();
  });
  it('reconciles the incoming call after server-authoritative glare rejects creation', async () => {
    const b = setup();
    b.api.create.mockRejectedValue({ response: { data: { code: 'PEER_BUSY' } } });
    b.api.active.mockResolvedValue([call] as never);
    await b.manager.dial('link');
    expect(b.manager.state).toMatchObject({ phase: 'RINGING', callId: 'call' });
    await b.manager.logout();
  });
  it('does not admit an incoming call queued before logout', async () => {
    const b = setup();
    const pending = b.manager.incoming(call);
    await b.manager.logout(); b.manager.setEnabled(true);
    await pending;
    expect(b.manager.state.phase).toBe('IDLE');
    await b.manager.logout();
  });
  it('bounds ringing even while media permission has not resolved', async () => {
    vi.useFakeTimers();
    let resume!: () => void;
    const b = setup({ prepareMedia: () => new Promise<void>(resolve => { resume = resolve; }) });
    b.api.create.mockResolvedValue({ ...created, call: { ...outgoing, ringExpiresAt: new Date(Date.now() + 60000).toISOString() } });
    const pending = b.manager.dial('link');
    try {
      await vi.advanceTimersByTimeAsync(60001);
      expect(b.manager.state).toMatchObject({ phase: 'ENDED', reason: 'timeout' });
    } finally {
      resume(); await pending; await b.manager.logout(); vi.useRealTimers();
    }
  });
  it('does not ring an old offer after logout and a new account generation', async () => {
    const b = setup();
    let resume!: (value: ServerCall) => void;
    b.api.get.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
    const pending = b.manager.signal(body('remote', { t: 'offer', media: 'audio', sdp: 'offer' }));
    await b.manager.logout(); b.manager.setEnabled(true);
    resume(call); await pending;
    expect(b.manager.state.phase).toBe('IDLE');
    await b.manager.logout();
  });
  it('does not create a second fork after hangup during the first offer send', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    let resume!: () => void;
    b.transport.send.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
    const dialing = b.manager.dial('link');
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
    await b.manager.hangup();
    resume();
    await dialing;
    expect(b.factory).toHaveBeenCalledTimes(1);
    expect(b.manager.busy).toBe(false);
  });
  it('keeps siblings ringing after a single callee device sends busy', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    b.api.get.mockResolvedValue(outgoing);
    await b.manager.dial('link');
    await b.manager.signal(body('one', { t: 'busy' }));
    expect(b.manager.busy).toBe(true);
    expect(b.api.get).toHaveBeenCalledWith('call');
    await b.manager.logout();
  });
  it('does not restore an old call after a stale reconcile completes', async () => {
    const b = setup();
    await b.manager.incoming(call);
    let resume!: (call: ServerCall) => void;
    b.api.get.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
    const reconciling = b.manager.reconcile();
    await b.manager.logout();
    b.manager.setEnabled(true);
    await b.manager.incoming({ ...call, id: 'new-call' });
    resume(call);
    await reconciling;
    expect(b.manager.call?.id).toBe('new-call');
    await b.manager.logout();
  });
  it('preserves mute across media replacement and new forks', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    b.manager.setMuted(true);
    await b.manager.dial('link');
    expect(b.media.setMuted).toHaveBeenCalledWith(true);
    await b.manager.logout();
  });
  it('does not end the global call when an unanswered callee hangs up locally', async () => {
    const b = setup();
    await b.manager.incoming(call);
    await b.manager.hangup();
    expect(b.api.decline).toHaveBeenCalledWith('call');
    expect(b.api.end).not.toHaveBeenCalled();
    expect(b.transport.send).not.toHaveBeenCalled();
  });
  it('does not let a retired media backend emit events for its replacement', async () => {
    const events: import('../../src/calls/callManager').MediaEvents[] = [];
    const b = setup();
    const factory = vi.fn((event: import('../../src/calls/callManager').MediaEvents) => {
      events.push(event);
      return { ...b.media };
    });
    const c = setup({ createMedia: factory });
    c.api.create.mockResolvedValue(created);
    await c.manager.dial('link');
    await c.manager.serverState({ ...outgoing, state: 'ACTIVE', answeredDeviceId: 'one' });
    await c.manager.signal(body('one', { sdp: undefined, needsOffer: true }));
    events[0]!.onError('OLD_BACKEND');
    await Promise.resolve();
    expect(c.manager.busy).toBe(true);
    await c.manager.logout();
  });
});
describe('call orchestrator', () => {
  it('waits for native microphone service readiness before creating a media backend', async () => {
    let ready!: () => void;
    const prepareMedia = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const releaseMedia = vi.fn(async () => {});
    const b = setup({ prepareMedia, releaseMedia });
    b.api.create.mockResolvedValue(created);
    const pending = b.manager.dial('link');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prepareMedia).toHaveBeenCalledTimes(1);
    expect(b.factory).not.toHaveBeenCalled();
    ready();
    await pending;
    expect(b.factory).toHaveBeenCalledTimes(2);
    await b.manager.hangup();
    expect(releaseMedia).toHaveBeenCalledTimes(1);
  });
  it('forks only the first two devices with distinct media objects', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    await b.manager.dial('link');
    expect(b.factory).toHaveBeenCalledTimes(2);
    expect(b.factory.mock.results[0]!.value).not.toBe(b.factory.mock.results[1]!.value);
    expect(b.transport.send.mock.calls.map((args) => args[1])).toEqual(['one', 'two']);
    await b.manager.logout();
  });
  it('buffers encrypted answers until REST chooses the winning device and closes losers', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    b.api.get.mockResolvedValue(outgoing);
    await b.manager.dial('link');
    await b.manager.signal(body('two'));
    expect(b.media.setRemoteAnswer).not.toHaveBeenCalled();
    await b.manager.serverState({ ...outgoing, state: 'ACTIVE', answeredDeviceId: 'two' });
    expect(b.media.setRemoteAnswer).toHaveBeenCalledExactlyOnceWith('answer');
    expect(b.media.close).toHaveBeenCalledTimes(1);
    await b.manager.signal(body('one'));
    expect(b.media.setRemoteAnswer).toHaveBeenCalledTimes(1);
    await b.manager.logout();
  });
  it('creates a fresh offer for a non-offered winning device', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    b.api.get.mockResolvedValue({ ...outgoing, state: 'ACTIVE', answeredDeviceId: 'three' });
    await b.manager.dial('link');
    await b.manager.signal(body('three', { sdp: undefined, needsOffer: true }));
    expect(b.factory).toHaveBeenCalledTimes(3);
    expect(b.transport.send).toHaveBeenLastCalledWith(
      'link',
      'three',
      expect.objectContaining({ t: 'offer', attempt: 2 }),
    );
    await b.manager.logout();
  });
  it('keeps a fast winning answer when an in-flight fork to another device is refused', async () => {
    const b = setup();
    const claimed = { ...outgoing, state: 'ACTIVE' as const, answeredDeviceId: 'two' };
    b.api.create.mockResolvedValue(created);
    b.api.get.mockResolvedValue(claimed);
    let rejectFork!: (error: Error) => void;
    b.transport.send.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFork = reject; }));
    const dialing = b.manager.dial('link');
    try {
      await vi.waitFor(() => expect(rejectFork).toBeTypeOf('function'));
      await b.manager.signal(body('two', { sdp: undefined, needsOffer: true }));
      rejectFork(new Error('CALL_DEVICE_MISMATCH'));
      await dialing;
      expect(b.manager.state).toMatchObject({ phase: 'CONNECTING', winnerDeviceId: 'two', attempt: 2 });
      expect(b.transport.send).toHaveBeenLastCalledWith('link', 'two', expect.objectContaining({ t: 'offer', attempt: 2 }));
      await b.manager.signal(body('two', { attempt: 2 }));
      expect(b.media.setRemoteAnswer).toHaveBeenCalledExactlyOnceWith('answer');
      expect(b.api.end).not.toHaveBeenCalled();
    } finally {
      rejectFork?.(new Error('test teardown'));
      await dialing;
      await b.manager.logout();
    }
  });
  it('accepts a cached authenticated offer only after the answer claim', async () => {
    const b = setup();
    await b.manager.incoming(call);
    await b.manager.signal(body('remote', { t: 'offer', sdp: 'offer', media: 'audio' }));
    expect(b.media.acceptOffer).not.toHaveBeenCalled();
    await b.manager.accept();
    expect(b.media.acceptOffer).toHaveBeenCalledWith('offer', [], 1);
    expect(b.transport.send).toHaveBeenCalledWith(
      'link',
      'remote',
      expect.objectContaining({ t: 'answer', sdp: 'answer' }),
    );
    await b.manager.logout();
  });
  it('never captures when REST returns a different answering device', async () => {
    const b = setup();
    b.api.answer.mockResolvedValue({
      call: { ...call, state: 'ACTIVE', answeredDeviceId: 'other' },
      iceServers: [],
      expiresAt: '',
    });
    await b.manager.incoming(call);
    await b.manager.signal(body('remote', { t: 'offer', sdp: 'offer', media: 'audio' }));
    await b.manager.accept();
    expect(b.factory).not.toHaveBeenCalled();
    expect(b.manager.state).toMatchObject({ phase: 'ENDED', reason: 'answered-elsewhere' });
  });
  it('buffers bounded trickle until the matching remote description is installed', async () => {
    const b = setup();
    await b.manager.incoming(call);
    const ice = body('remote', {
      t: 'ice',
      cand: 'candidate:test',
      mid: '0',
      mline: 0,
      ufrag: 'remote',
    });
    await b.manager.signal(ice);
    expect(b.media.addIce).not.toHaveBeenCalled();
    await b.manager.signal(body('remote', { t: 'offer', sdp: 'offer', media: 'audio' }));
    await b.manager.accept();
    expect(b.media.addIce).toHaveBeenCalledWith({
      candidate: 'candidate:test',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'remote',
    });
    await b.manager.logout();
  });
  it('ignores a completed REST answer after the user hangs up', async () => {
    const b = setup();
    let resolve!: (value: unknown) => void;
    b.api.answer.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }) as never,
    );
    await b.manager.incoming(call);
    const pending = b.manager.accept();
    await b.manager.hangup();
    resolve({
      call: { ...call, state: 'ACTIVE', answeredDeviceId: 'local' },
      iceServers: [],
      expiresAt: '',
    });
    await pending;
    expect(b.factory).not.toHaveBeenCalled();
    expect(b.manager.state.phase).toBe('ENDED');
    expect(b.api.end).toHaveBeenCalledWith('call', 'cancelled');
  });
  it('closes old media synchronously when hangup races a new dial', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    await b.manager.dial('link');
    const ending = b.manager.hangup();
    expect(b.media.close).toHaveBeenCalledTimes(2);
    await ending;
  });
  it('closes every fork when the kill switch flips', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    await b.manager.dial('link');
    b.manager.setEnabled(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(b.manager.state).toMatchObject({ phase: 'ENDED', reason: 'unavailable' });
    expect(b.media.close).toHaveBeenCalledTimes(2);
  });
  it('performs one credential-refreshed ICE restart, then fails closed on a second media failure', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    b.api.get.mockResolvedValue({ ...outgoing, state: 'ACTIVE', answeredDeviceId: 'one' });
    await b.manager.dial('link');
    await b.manager.signal(body('one'));
    await b.manager.event({ type: 'MEDIA_CONNECTED', callId: 'call', attempt: 1 });
    expect(b.manager.state.phase).toBe('ACTIVE');
    await b.manager.event({ type: 'MEDIA_FAILED', callId: 'call', attempt: 1 });
    expect(b.api.ice).toHaveBeenCalledWith('call');
    expect(b.media.restartIce).toHaveBeenCalledWith([], 2);
    expect(b.transport.send).toHaveBeenLastCalledWith(
      'link',
      'one',
      expect.objectContaining({ t: 'offer', attempt: 2 }),
    );
    await b.manager.signal(body('one', { attempt: 2 }));
    await b.manager.event({ type: 'MEDIA_CONNECTED', callId: 'call', attempt: 2 });
    expect(b.manager.state.phase).toBe('ACTIVE');
    await b.manager.event({ type: 'MEDIA_FAILED', callId: 'call', attempt: 2 });
    expect(b.manager.state).toMatchObject({ phase: 'ENDED', reason: 'failed' });
    expect(b.api.end).toHaveBeenCalledWith('call', 'failed');
  });
  it('preserves live media during a websocket flap and reconciles on restoration', async () => {
    const b = setup();
    b.api.create.mockResolvedValue(created);
    b.api.get.mockResolvedValue({ ...outgoing, state: 'ACTIVE', answeredDeviceId: 'one' });
    await b.manager.dial('link');
    await b.manager.signal(body('one'));
    await b.manager.event({ type: 'MEDIA_CONNECTED', callId: 'call', attempt: 1 });
    b.media.close.mockClear();
    b.api.get.mockClear();
    await b.manager.event({ type: 'SOCKET_LOST' });
    expect(b.media.close).not.toHaveBeenCalled();
    await b.manager.event({ type: 'SOCKET_RESTORED' });
    expect(b.api.get).toHaveBeenCalledWith('call');
    expect(b.manager.state.phase).toBe('ACTIVE');
    await b.manager.logout();
  });
  it('never captures while ringing; REST claim must precede media', async () => {
    const b = setup();
    await b.manager.incoming(call);
    expect(b.factory).not.toHaveBeenCalled();
    await b.manager.accept();
    expect(b.api.answer).toHaveBeenCalledWith('call');
    expect(b.factory).not.toHaveBeenCalled(); // no offer: request a fresh authenticated offer
    expect(b.transport.send).toHaveBeenCalledWith(
      'link',
      'remote',
      expect.objectContaining({ t: 'answer', needsOffer: true }),
    );
    await b.manager.logout();
  });
  it('does not resurrect a locally ended call from a late encrypted offer', async () => {
    const b = setup();
    await b.manager.incoming(call);
    await b.manager.decline();
    await b.manager.signal({
      mc: 1,
      kind: 'call',
      cid: 'call',
      dev: 'remote',
      attempt: 1,
      t: 'offer',
      media: 'audio',
      sdp: 'offer',
      ts: Date.now(),
    });
    expect(b.manager.state.phase).toBe('ENDED');
    await b.manager.logout();
  });
  it('ends the server call on logout and closes media without waiting for signalling', async () => {
    const b = setup();
    await b.manager.incoming(call);
    await b.manager.accept();
    await b.manager.logout();
    expect(b.api.end).toHaveBeenCalledWith('call', 'cancelled');
    expect(b.manager.state.phase).toBe('IDLE');
  });
});

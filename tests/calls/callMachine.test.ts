import { describe, it, expect } from 'vitest';
import { initialState, reduce } from '../../src/calls/callMachine';

const outgoing = () => reduce(reduce(initialState, { type: 'DIAL', localDeviceId: 'local' }).state, { type: 'CREATED', callId: 'c', peerDeviceId: 'peer' }).state;
const claimed = () => reduce(outgoing(), { type: 'SERVER_STATE', callId: 'c', state: 'ACTIVE', answeredDeviceId: 'peer' }).state;
const connected = () => reduce(reduce(claimed(), { type: 'ANSWER', callId: 'c', deviceId: 'peer', attempt: 1, needsOffer: false }).state, { type: 'MEDIA_CONNECTED', callId: 'c', attempt: 1 }).state;
describe('pure call machine', () => {
  it('initiates caller capture only from user dial + committed create and keeps ACTIVE distinct', () => {
    const dial = reduce(initialState, { type: 'DIAL', localDeviceId: 'local' });
    expect(dial.state.phase).toBe('DIALING');
    expect(dial.effects).toEqual([{ type: 'CREATE_CALL' }]);
    expect(outgoing().phase).toBe('DIALING');
    expect(reduce(outgoing(), { type: 'MEDIA_CONNECTED', callId: 'c', attempt: 1 }).state.phase).not.toBe('ACTIVE');
    const early = reduce(outgoing(), { type: 'ANSWER', callId: 'c', deviceId: 'peer', attempt: 1, needsOffer: false });
    expect(early.effects).toEqual([{ type: 'RECONCILE' }]);
    expect(claimed().phase).toBe('CONNECTING');
    const answered = reduce(claimed(), { type: 'ANSWER', callId: 'c', deviceId: 'peer', attempt: 1, needsOffer: false });
    expect(answered.effects).toContainEqual({ type: 'APPLY_ANSWER', attempt: 1 });
    expect(reduce(answered.state, { type: 'ANSWER', callId: 'c', deviceId: 'peer', attempt: 1, needsOffer: false }).effects).toEqual([]);
    expect(reduce(claimed(), { type: 'ANSWER', callId: 'c', deviceId: 'sibling', attempt: 1, needsOffer: false }).effects).toEqual([]);
    expect(connected().phase).toBe('ACTIVE');
  });
  it('reconciles server-first glare without device-id election', () => {
    const conflict = reduce(outgoing(), { type: 'CREATE_FAILED', code: 'PEER_BUSY' });
    expect(conflict.state.phase).toBe('ENDED');
    expect(conflict.effects).toContainEqual({ type: 'RECONCILE' });
    expect(conflict.effects.map(e => e.type)).not.toContain('END_CALL');
  });

  it('does not open incoming microphone until REST winner matches this device', () => {
    const ring = reduce(initialState, { type: 'INCOMING', callId: 'c', localDeviceId: 'local', peerDeviceId: 'peer', hasOffer: true });
    expect(ring.state.phase).toBe('RINGING');
    expect(ring.effects.map(e => e.type)).not.toContain('ACCEPT_OFFER');
    const accept = reduce(ring.state, { type: 'ACCEPT' });
    expect(accept.state.phase).toBe('ACCEPTING');
    expect(accept.effects).toContainEqual({ type: 'CLAIM_ANSWER' });
    const loser = reduce(accept.state, { type: 'CLAIMED', callId: 'c', answeredDeviceId: 'sibling' });
    expect(loser.state).toMatchObject({ phase: 'ENDED', reason: 'answered-elsewhere' });
    expect(loser.effects.map(e => e.type)).not.toContain('ACCEPT_OFFER');
    const winner = reduce(accept.state, { type: 'CLAIMED', callId: 'c', answeredDeviceId: 'local' });
    expect(winner.state.phase).toBe('CONNECTING');
    expect(winner.effects).toContainEqual({ type: 'ACCEPT_OFFER', attempt: 1 });
  });
  it('uses bounded ring/connection timers, idempotent terminal cleanup and ignores obsolete attempts', () => {
    const timed = reduce(outgoing(), { type: 'TIMER', timer: 'ring', callId: 'c', attempt: 1 });
    expect(timed.state).toMatchObject({ phase: 'ENDED', reason: 'timeout' });
    expect(timed.effects).toContainEqual({ type: 'END_CALL', reason: 'timeout' });
    expect(reduce(timed.state, { type: 'HANGUP' }).effects).toEqual([]);
    expect(reduce(claimed(), { type: 'TIMER', timer: 'connect', callId: 'c', attempt: 1 }).state).toMatchObject({ phase: 'ENDED', reason: 'failed' });
    expect(reduce(connected(), { type: 'TIMER', timer: 'ring', callId: 'c', attempt: 1 }).effects).toEqual([]);
    expect(reduce(connected(), { type: 'MEDIA_FAILED', callId: 'c', attempt: 0 }).effects).toEqual([]);
  });
  it('waits five seconds for disconnect and restarts exactly once', () => {
    const disconnect = reduce(connected(), { type: 'MEDIA_DISCONNECTED', callId: 'c', attempt: 1 });
    expect(disconnect.state.phase).toBe('ACTIVE');
    expect(disconnect.effects).toEqual([{ type: 'START_TIMER', timer: 'disconnect', ms: 5000, attempt: 1 }]);
    expect(reduce(disconnect.state, { type: 'MEDIA_CONNECTED', callId: 'c', attempt: 1 }).effects).toContainEqual({ type: 'STOP_TIMER', timer: 'disconnect' });
    const restart = reduce(disconnect.state, { type: 'TIMER', timer: 'disconnect', callId: 'c', attempt: 1 });
    expect(restart.state).toMatchObject({ phase: 'RESTARTING', attempt: 2 });
    expect(restart.effects).toContainEqual({ type: 'RESTART_ICE', attempt: 2 });
    expect(reduce(restart.state, { type: 'MEDIA_CONNECTED', callId: 'c', attempt: 1 }).effects).toEqual([]);
    expect(reduce(restart.state, { type: 'MEDIA_FAILED', callId: 'c', attempt: 2 }).state).toMatchObject({ phase: 'ENDED', reason: 'failed' });
  });
  it('retains media on socket loss, reconciles after 45s and on reconnect', () => {
    const lost = reduce(connected(), { type: 'SOCKET_LOST' });
    expect(lost.state.phase).toBe('ACTIVE');
    expect(lost.effects).toEqual([{ type: 'START_TIMER', timer: 'socket', ms: 45000, attempt: 1 }]);
    expect(reduce(lost.state, { type: 'SOCKET_LOST' }).effects).toEqual([]);
    expect(reduce(lost.state, { type: 'TIMER', callId: 'c', attempt: 1, timer: 'socket' }).effects).toEqual([{ type: 'RECONCILE' }]);
    expect(reduce(lost.state, { type: 'SOCKET_RESTORED' }).effects).toEqual([{ type: 'STOP_TIMER', timer: 'socket' }, { type: 'RECONCILE' }]);
    expect(reduce(lost.state, { type: 'SERVER_STATE', callId: 'c', state: 'ENDED', answeredDeviceId: 'peer', reason: 'lost' }).state).toMatchObject({ phase: 'ENDED', reason: 'lost' });
  });
  it.each(['LOGOUT', 'FEATURE_OFF', 'LINK_SEVERED', 'DEVICE_REVOKED'] as const)('tears down on %s only once', type => {
    const ended = reduce(connected(), { type });
    expect(ended.state.phase).toBe('ENDED');
    for (const effect of ['STOP_TIMERS', 'CLOSE_MEDIA', 'REPORT_END']) expect(ended.effects.filter(e => e.type === effect)).toHaveLength(1);
    expect(reduce(ended.state, { type }).effects).toEqual([]);
  });
  it('claims first for offerPending and accepts subsequent offers only from the caller', () => {
    const ring = reduce(initialState, { type: 'INCOMING', callId: 'c', localDeviceId: 'local', peerDeviceId: 'peer', hasOffer: false }).state;
    const accept = reduce(ring, { type: 'ACCEPT' }).state;
    const winner = reduce(accept, { type: 'CLAIMED', callId: 'c', answeredDeviceId: 'local' });
    expect(winner.effects).toContainEqual({ type: 'SEND_NEEDS_OFFER', attempt: 1 });
    expect(winner.effects.map(e => e.type)).not.toContain('ACCEPT_OFFER');
    const offer = reduce(winner.state, { type: 'OFFER', callId: 'c', deviceId: 'peer', attempt: 2 });
    expect(offer.state).toMatchObject({ phase: 'CONNECTING', attempt: 2 });
    expect(offer.effects).toContainEqual({ type: 'ACCEPT_OFFER', attempt: 2 });
    expect(reduce(winner.state, { type: 'OFFER', callId: 'c', deviceId: 'sibling', attempt: 2 }).effects).toEqual([]);
    expect(reduce(offer.state, { type: 'OFFER', callId: 'c', deviceId: 'peer', attempt: 2 }).effects).toEqual([]);
    const request = reduce(claimed(), { type: 'ANSWER', callId: 'c', deviceId: 'peer', attempt: 1, needsOffer: true });
    expect(request.effects).toContainEqual({ type: 'START_OUTGOING', attempt: 2 });
  });
  it('declines/rejects permission and remote terminal without duplicate end sends', () => {
    const ring = reduce(initialState, { type: 'INCOMING', callId: 'c', localDeviceId: 'local', peerDeviceId: 'peer', hasOffer: false }).state;
    expect(reduce(ring, { type: 'DECLINE' }).effects).toContainEqual({ type: 'DECLINE_CALL', reason: 'declined' });
    expect(reduce(claimed(), { type: 'MEDIA_ERROR', callId: 'c', attempt: 1 }).state).toMatchObject({ phase: 'ENDED', reason: 'failed' });
    expect(reduce(connected(), { type: 'REMOTE_END', callId: 'c', attempt: 1, deviceId: 'sibling', reason: 'normal' }).effects).toEqual([]);
    const remote = reduce(connected(), { type: 'REMOTE_END', callId: 'c', attempt: 1, deviceId: 'peer', reason: 'normal' });
    expect(remote.state.phase).toBe('ENDED');
    expect(remote.effects.map(e => e.type)).not.toContain('END_CALL');
  });
});

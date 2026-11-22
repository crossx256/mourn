import type { ClientCallState, EndReason, ServerCallState } from './types';
import { validAttempt } from './codec';

export type Timer = 'ring' | 'connect' | 'disconnect' | 'socket';
interface Session {
  callId: string; localDeviceId: string; peerDeviceId: string; role: 'caller' | 'callee';
  attempt: number; winnerDeviceId: string | null; hasOffer: boolean; answerApplied: boolean;
  restarted: boolean; socketLost: boolean; disconnected: boolean;
}
export type MachineState = { phase: 'IDLE' } | (Session & { phase: Exclude<ClientCallState, 'IDLE' | 'ENDED'> }) | (Session & { phase: 'ENDED'; reason: EndReason });
type Scoped = { callId: string; attempt: number };
export type MachineEvent =
  | { type: 'INCOMING'; callId: string; localDeviceId: string; peerDeviceId: string; hasOffer: boolean; ringRemainingMs?: number }
  | { type: 'DIAL'; localDeviceId: string }
  | { type: 'CREATED'; callId: string; peerDeviceId: string; ringRemainingMs?: number }
  | { type: 'CREATE_FAILED'; code: 'PEER_BUSY' | 'UNAVAILABLE' }
  | { type: 'SERVER_STATE'; callId: string; state: ServerCallState; answeredDeviceId: string | null; reason?: EndReason }
  | ({ type: 'ANSWER'; deviceId: string; needsOffer: boolean } & Scoped)
  | ({ type: 'OFFER'; deviceId: string } & Scoped)
  | ({ type: 'MEDIA_CONNECTED' | 'MEDIA_DISCONNECTED' | 'MEDIA_FAILED' | 'MEDIA_ERROR' } & Scoped)
  | ({ type: 'TIMER'; timer: Timer } & Scoped)
  | ({ type: 'REMOTE_END'; deviceId: string; reason: EndReason } & Scoped)
  | { type: 'ACCEPT' | 'DECLINE' | 'HANGUP' | 'LOGOUT' | 'FEATURE_OFF' | 'LINK_SEVERED' | 'DEVICE_REVOKED' | 'SOCKET_LOST' | 'SOCKET_RESTORED' }
  | { type: 'CLAIM_FAILED'; callId: string; reason: 'answered-elsewhere' | 'unavailable' }
  | { type: 'CLAIMED'; callId: string; answeredDeviceId: string };
export type MachineEffect =
  | { type: 'START_TIMER'; timer: Timer; ms: number; attempt: number }
  | { type: 'STOP_TIMER'; timer: Timer }
  | { type: 'STOP_TIMERS' | 'STOP_RING' | 'CLOSE_MEDIA' | 'CLAIM_ANSWER' | 'CREATE_CALL' | 'RECONCILE' }
  | { type: 'ACCEPT_OFFER' | 'START_OUTGOING' | 'APPLY_ANSWER' | 'RESTART_ICE' | 'SEND_NEEDS_OFFER'; attempt: number }
  | { type: 'REPORT_END' | 'END_CALL' | 'SEND_HANGUP'; reason: EndReason }
  | { type: 'DECLINE_CALL'; reason: 'declined' };
export interface Transition { state: MachineState; effects: MachineEffect[] }
export const initialState: MachineState = { phase: 'IDLE' };
const timer = (name: Timer, ms: number, attempt: number): MachineEffect => ({ type: 'START_TIMER', timer: name, ms, attempt });
const ringMs = (remaining = 60_000): number => Number.isFinite(remaining) ? Math.max(0, Math.min(60_000, remaining)) : 0;
function finish(state: Session, reason: EndReason, local = false): Transition {
  const effects: MachineEffect[] = [{ type: 'STOP_TIMERS' }, { type: 'STOP_RING' }, { type: 'CLOSE_MEDIA' }, { type: 'REPORT_END', reason }];
  if (local && state.callId) effects.push({ type: 'SEND_HANGUP', reason }, { type: 'END_CALL', reason });
  return { state: { ...state, phase: 'ENDED', reason }, effects };
}
function restart(state: Session): Transition {
  if (state.restarted || !validAttempt(state.attempt + 1)) return finish(state, 'failed', true);
  const attempt = state.attempt + 1;
  return { state: { ...state, phase: 'RESTARTING', attempt, restarted: true, answerApplied: false, hasOffer: false, disconnected: false }, effects: [{ type: 'STOP_TIMER', timer: 'disconnect' }, timer('connect', 20_000, attempt), { type: state.role === 'caller' ? 'RESTART_ICE' : 'SEND_NEEDS_OFFER', attempt }] };
}
export function reduce(state: MachineState, event: MachineEvent): Transition {
  const same: Transition = { state, effects: [] };
  if (state.phase === 'IDLE') {
    const common = { attempt: 1, winnerDeviceId: null, answerApplied: false, restarted: false, socketLost: false, disconnected: false };
    if (event.type === 'DIAL') return { state: { ...common, phase: 'DIALING', role: 'caller', localDeviceId: event.localDeviceId, callId: '', peerDeviceId: '', hasOffer: false }, effects: [{ type: 'CREATE_CALL' }] };
    if (event.type !== 'INCOMING') return same;
    return { state: { ...common, phase: 'RINGING', callId: event.callId, localDeviceId: event.localDeviceId, peerDeviceId: event.peerDeviceId, hasOffer: event.hasOffer, role: 'callee' }, effects: [timer('ring', ringMs(event.ringRemainingMs), 1)] };
  }
  // A manager creates a fresh machine per call; stale async completions never resurrect it.
  if (state.phase === 'ENDED') return same;
  if (event.type === 'CREATED' && state.phase === 'DIALING' && !state.callId) return { state: { ...state, callId: event.callId, peerDeviceId: event.peerDeviceId }, effects: [timer('ring', ringMs(event.ringRemainingMs), 1), { type: 'START_OUTGOING', attempt: 1 }] };
  if (event.type === 'CREATE_FAILED' && state.phase === 'DIALING') {
    const result = finish(state, event.code === 'PEER_BUSY' ? 'busy' : 'unavailable');
    if (event.code === 'PEER_BUSY') result.effects.push({ type: 'RECONCILE' });
    return result;
  }
  if ('callId' in event && event.callId !== state.callId) return same;
  // Caller alone advances offers; offerPending requests echo current attempt, restart requests use next.
  if (event.type === 'OFFER' && state.role === 'callee' && event.deviceId === state.peerDeviceId && validAttempt(event.attempt)) {
    if (state.phase === 'RINGING' && event.attempt === state.attempt && !state.hasOffer) return { state: { ...state, hasOffer: true }, effects: [] };
    if (state.winnerDeviceId !== state.localDeviceId) return same;
    if (event.attempt < state.attempt || event.attempt > state.attempt + 1 || state.hasOffer && event.attempt === state.attempt) return same;
    if (!['CONNECTING', 'ACTIVE', 'RESTARTING'].includes(state.phase)) return same;
    if (state.phase === 'ACTIVE' && state.restarted) return finish(state, 'failed', true);
    return { state: { ...state, phase: state.phase === 'ACTIVE' || state.phase === 'RESTARTING' ? 'RESTARTING' : 'CONNECTING', attempt: event.attempt, hasOffer: true, restarted: state.restarted || state.phase === 'ACTIVE' }, effects: [timer('connect', 20_000, event.attempt), { type: 'ACCEPT_OFFER', attempt: event.attempt }] };
  }
  if (event.type === 'ANSWER' && event.needsOffer && state.role === 'caller' && event.deviceId === state.winnerDeviceId) {
    if (state.phase === 'CONNECTING' && !state.answerApplied && event.attempt === state.attempt && !state.restarted) {
      const attempt = state.attempt + 1;
      if (!validAttempt(attempt)) return finish(state, 'failed', true);
      return { state: { ...state, attempt, hasOffer: false }, effects: [{ type: 'START_OUTGOING', attempt }, timer('connect', 20_000, attempt)] };
    }
    if (state.phase === 'ACTIVE' && event.attempt === state.attempt + 1) return restart(state);
    return same;
  }
  if ('attempt' in event && event.attempt !== state.attempt) return same;
  if (event.type === 'LOGOUT') return finish(state, 'cancelled');
  if (event.type === 'FEATURE_OFF') return finish(state, 'unavailable', true);
  if (event.type === 'LINK_SEVERED') return finish(state, 'link-severed');
  if (event.type === 'DEVICE_REVOKED') return finish(state, 'device-revoked');
  if (event.type === 'HANGUP') return finish(state, state.phase === 'DIALING' ? 'cancelled' : 'normal', true);
  if (event.type === 'DECLINE' && state.phase === 'RINGING') {
    const result = finish(state, 'declined'); result.effects.push({ type: 'DECLINE_CALL', reason: 'declined' }); return result;
  }
  if (event.type === 'REMOTE_END' && event.deviceId === (state.winnerDeviceId && state.role === 'caller' ? state.winnerDeviceId : state.peerDeviceId)) return finish(state, event.reason);
  if (event.type === 'SERVER_STATE') {
    if (event.state !== 'RINGING' && event.state !== 'ACTIVE') return finish(state, event.reason ?? ({ MISSED: 'timeout', DECLINED: 'declined', BUSY: 'busy', CANCELLED: 'cancelled', FAILED: 'failed', ENDED: 'normal' } as const)[event.state]);
    if (event.state !== 'ACTIVE' || !event.answeredDeviceId) return same;
    if (state.role === 'callee' && event.answeredDeviceId !== state.localDeviceId) return finish(state, 'answered-elsewhere');
    // Socket metadata is not the callee's REST permission claim.
    if (state.role === 'callee' || state.winnerDeviceId) return same;
    return { state: { ...state, phase: 'CONNECTING', winnerDeviceId: event.answeredDeviceId, peerDeviceId: event.answeredDeviceId }, effects: [{ type: 'STOP_TIMER', timer: 'ring' }, timer('connect', 20_000, state.attempt)] };
  }
  if (event.type === 'ANSWER' && state.role === 'caller') {
    if (!state.winnerDeviceId) return { state, effects: [{ type: 'RECONCILE' }] };
    if (event.deviceId !== state.winnerDeviceId || state.answerApplied) return same;
    return { state: { ...state, answerApplied: true }, effects: [{ type: 'APPLY_ANSWER', attempt: state.attempt }] };
  }
  if (event.type === 'ACCEPT' && state.phase === 'RINGING') return { state: { ...state, phase: 'ACCEPTING' }, effects: [{ type: 'CLAIM_ANSWER' }] };
  if (event.type === 'CLAIM_FAILED' && state.phase === 'ACCEPTING') return finish(state, event.reason);
  if (event.type === 'CLAIMED' && state.phase === 'ACCEPTING') {
    if (event.answeredDeviceId !== state.localDeviceId) return finish(state, 'answered-elsewhere');
    return { state: { ...state, phase: 'CONNECTING', winnerDeviceId: event.answeredDeviceId }, effects: [{ type: 'STOP_RING' }, { type: 'STOP_TIMER', timer: 'ring' }, timer('connect', 20_000, state.attempt), { type: state.hasOffer ? 'ACCEPT_OFFER' : 'SEND_NEEDS_OFFER', attempt: state.attempt }] };
  }
  if (event.type === 'MEDIA_ERROR') return finish(state, 'failed', true);
  if (event.type === 'MEDIA_FAILED') return state.phase === 'ACTIVE' ? restart(state) : finish(state, 'failed', true);
  if (event.type === 'MEDIA_CONNECTED') {
    if (state.phase === 'ACTIVE') return { state: { ...state, disconnected: false }, effects: [{ type: 'STOP_TIMER', timer: 'disconnect' }] };
    if (state.winnerDeviceId && (state.phase === 'CONNECTING' || state.phase === 'RESTARTING') && (state.role === 'callee' || state.answerApplied)) return { state: { ...state, phase: 'ACTIVE', disconnected: false }, effects: [{ type: 'STOP_TIMER', timer: 'connect' }, { type: 'STOP_TIMER', timer: 'disconnect' }] };
  }
  if (event.type === 'MEDIA_DISCONNECTED' && state.phase === 'ACTIVE' && !state.disconnected) return { state: { ...state, disconnected: true }, effects: [timer('disconnect', 5000, state.attempt)] };
  if (event.type === 'SOCKET_LOST' && !state.socketLost) return { state: { ...state, socketLost: true }, effects: [timer('socket', 45_000, state.attempt)] };
  if (event.type === 'SOCKET_RESTORED') return { state: { ...state, socketLost: false }, effects: [{ type: 'STOP_TIMER', timer: 'socket' }, { type: 'RECONCILE' }] };
  if (event.type === 'TIMER') {
    if (event.timer === 'ring' && ['DIALING', 'RINGING', 'ACCEPTING'].includes(state.phase)) return finish(state, 'timeout', true);
    if (event.timer === 'connect' && ['CONNECTING', 'RESTARTING'].includes(state.phase)) return finish(state, 'failed', true);
    if (event.timer === 'disconnect' && state.phase === 'ACTIVE' && state.disconnected) return restart(state);
    if (event.timer === 'socket' && state.socketLost) return { state, effects: [{ type: 'RECONCILE' }] };
  }
  return same;
}

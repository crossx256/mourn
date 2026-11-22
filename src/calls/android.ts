import { mobilePlatform } from 'src/utils/platform';
import type { PluginListenerHandle } from '@capacitor/core';

export type AndroidAudioRoute = 'earpiece' | 'speaker' | 'bluetooth' | 'wired';
export interface AndroidIncomingCall {
  callId: string;
  linkId: string;
  callerDeviceId: string;
  /** Server deadline, ISO-8601 UTC; must be future and at most 60 seconds away. */
  expiresAt: string;
}
export interface AndroidCallAction {
  callId: string;
  /** open is a ring/reconcile hint (including foreground FCM), NEVER user acceptance. */
  action: 'open' | 'answer' | 'decline' | 'end';
  expiresAt: string;
  /** Absent for an outgoing call's ongoing-notification action. */
  linkId?: string;
  callerDeviceId?: string;
}
export interface AndroidAudioDevice { id: string; route: AndroidAudioRoute }
export interface AndroidServiceState {
  callId: string;
  state: 'started' | 'stopped' | 'error';
  code?: string;
}
export interface AndroidCallsPlugin {
  requestMicPermission(): Promise<{ granted: boolean }>;
  requestBluetoothPermission(): Promise<{ granted: boolean }>;
  /** Must follow a foreground user dial/accept + server authorization, BEFORE getUserMedia.
   * Resolves only after microphone FGS and audio focus are ready. No media capture itself.
   * On any later error/hangup, close WebRTC tracks then stopCallService in finally.
   */
  startCallService(options: { callId: string; userInitiated: true }): Promise<void>;
  stopCallService(options: { callId: string }): Promise<void>;
  setAudioRoute(options: { callId: string; route: AndroidAudioRoute }): Promise<void>;
  /** WebRTC track.enabled remains authoritative; this also sets OS microphone mute. */
  setMuted(options: { callId: string; muted: boolean }): Promise<void>;
  getAudioDevices(): Promise<{ devices: AndroidAudioDevice[] }>;
  showIncoming(options: AndroidIncomingCall): Promise<{ shown: boolean }>;
  cancelIncoming(options: { callId: string }): Promise<void>;
  /** Atomic drain. Register callActionAvailable first, then drain at boot and on each hint.
   * Subscribe callServiceState too: stopped/error MUST close media tracks + end/reconcile
   * the manager call (OS focus loss, service failure, task removal and the 4h cap).
   * On audioFocusChanged transient/duck, disable WebRTC send tracks until gain; permanent
   * loss stops native lifecycle. Native also mutes OS capture while focus is absent.
   * Events are hints only; all actions come from this queue (no double-dispatch).
   * Native validates notification capability + TTL, NOT server membership/state.
   * Reconcile /calls/active + encrypted offer after auth/vault init before acting.
   * Decline is locally cancelled immediately; JS may send authenticated decline when ready.
   * Native NEVER stores bearer tokens or invents cold-start authentication.
   */
  getPendingActions(): Promise<{ actions: AndroidCallAction[] }>;
  /** Logout/account boundary, after closing media: cancel pending starts/services/rings,
   * drop queued hints, invalidate notification capabilities; retain replay tombstones.
   * Does not revoke the FCM token; authenticated mobile logout owns that separately.
   */
  resetCallState(): Promise<void>;
  /** Default false. Set true only after authenticated device initialization + enabled
   * server config; persist for killed-app FCM. False also resets native lifecycle.
   * Await resetCallState on logout/account change; never enable from a push hint.
   */
  setIncomingEnabled(options: { enabled: boolean; ringtone?: 'system' | 'silent'; vibrate?: boolean }): Promise<void>;
  addListener(event: 'callActionAvailable', listener: () => void): Promise<PluginListenerHandle>;
  addListener(event: 'callServiceState', listener: (event: AndroidServiceState) => void): Promise<PluginListenerHandle>;
  addListener(event: 'audioFocusChanged', listener: (event: {
    callId: string; focus: 'gain' | 'loss' | 'loss-transient' | 'duck';
  }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'audioDevicesChanged', listener: () => void): Promise<PluginListenerHandle>;
}

/** Guard calls with isAndroidCallsPlatform(); deliberately no fake web implementation. */
let plugin: Promise<{ bridge: AndroidCallsPlugin }> | undefined;
async function loadPlugin() {
  if (!isAndroidCallsPlatform()) throw new Error('ANDROID_CALLS_UNAVAILABLE');
  // Wrap the Capacitor proxy so Promise resolution never probes its synthetic `then` method.
  plugin ??= import('@capacitor/core').then(({ registerPlugin }) => ({ bridge: registerPlugin<AndroidCallsPlugin>('MournCalls') }));
  return plugin;
}
export const AndroidCalls = new Proxy({} as AndroidCallsPlugin, {
  get(_target, property) {
    if (property === 'then' || typeof property !== 'string') return undefined;
    return async (...args: unknown[]) => {
      const { bridge } = await loadPlugin();
      const method = Reflect.get(bridge, property) as (...values: unknown[]) => unknown;
      return method.apply(bridge, args);
    };
  },
});
export function isAndroidCallsPlatform(): boolean {
  return mobilePlatform() === 'android';
}

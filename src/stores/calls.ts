import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { CallManager } from 'src/calls/callManager';
import type { CallTransport } from 'src/calls/callManager';
import type { MachineState } from 'src/calls/callMachine';
import type { CallBody, EndReason, ServerCall, ServerCallState } from 'src/calls/types';
import { END_REASONS } from 'src/calls/codec';
import type { CallStats } from 'src/calls/media/browserMedia';
import { BrowserMedia, browserMediaSupport } from 'src/calls/media/browserMedia';
import { callsApi } from 'src/calls/api';
import { AndroidCalls, isAndroidCallsPlatform } from 'src/calls/android';
import { mobilePlatform } from 'src/utils/platform';

// Vault owns encryption and live-only delivery. No offline replay or fallback signalling here.
let transport: CallTransport | null = null;
const managers = new Set<CallManager>();
export function setCallTransport(next: CallTransport | null) {
  transport = next;
  for (const manager of managers) manager.setTransport(next ?? unavailableTransport);
}
const unavailableTransport: CallTransport = {
  send: async () => {
    throw new Error('CALL_TRANSPORT_UNAVAILABLE');
  },
};
export const useCallsStore = defineStore('calls', () => {
  const state = shallowRef<MachineState>({ phase: 'IDLE' });
  const call = shallowRef<ServerCall | null>(null);
  const enabled = ref(false);
  const supported = ref(false);
  const startupComplete = ref(false);
  const error = ref<string | null>(null);
  const history = shallowRef<ServerCall[]>([]);
  const hasMore = ref(false);
  const loading = ref(false);
  const muted = ref(false);
  const speaker = ref(false);
  const stats = shallowRef<CallStats | null>(null);
  let focusMuted = false;
  const android = isAndroidCallsPlatform();
  const minimized = ref(false);
  const alwaysRelay = ref(false);
  const sessionRelay = ref(false);
  const ringtone = ref<'system' | 'silent'>('system');
  const vibrate = ref(true);
  // Device identifiers and labels are deliberately memory-only.
  const micDeviceId = ref('');
  const microphones = shallowRef<{ label: string; value: string }[]>([]);
  const microphoneLoading = ref(false);
  const microphoneError = ref<string | null>(null);
  function setMicrophone(id: string) { if (!busy.value) micDeviceId.value = id; }
  async function loadMicrophones() {
    const current = epoch;
    if (!accountId || microphoneLoading.value) return;
    microphoneLoading.value = true;
    microphoneError.value = null;
    try {
      const rows = await navigator.mediaDevices.enumerateDevices();
      if (current !== epoch) return;
      microphones.value = rows.filter(row => row.kind === 'audioinput' && row.deviceId).map((row, index) => ({ label: row.label || `Microphone ${index + 1}`, value: row.deviceId }));
    } catch {
      if (current === epoch) microphoneError.value = 'Microphone list unavailable. Allow microphone access during a call, then refresh.';
    } finally { if (current === epoch) microphoneLoading.value = false; }
  }
  function setRingtone(value: 'system' | 'silent') {
    ringtone.value = value;
    saveAlerts();
  }
  function setVibrate(value: boolean) { vibrate.value = value; saveAlerts(); }
  function nativeEligibility(enabled: boolean) {
    return { enabled, ringtone: ringtone.value, vibrate: vibrate.value };
  }
  function saveAlerts() {
    try { if (accountId) localStorage.setItem(`mourn_calls_alerts_${accountId}`, JSON.stringify({ ringtone: ringtone.value, vibrate: vibrate.value })); } catch { /* ephemeral preference */ }
    if (android && accountId && enabled.value && manager.value) {
      const current = epoch;
      void nativeFor(current, async () => {
        if (accountId && manager.value && enabled.value && supported.value) await AndroidCalls.setIncomingEnabled(nativeEligibility(true));
      }).catch(() => {});
    }
  }
  const manager = shallowRef<CallManager | null>(null);
  let cursor: string | null = null;
  let epoch = 0;
  let loadingEpoch = 0;
  let accountId = '';
  let lastAccountId = '';
  let teardown: Promise<void> = Promise.resolve();
  let nativeQueue: Promise<void> = Promise.resolve();
  let configRevision = 0;
  function nativeFor(current: number, action: () => Promise<unknown>) {
    nativeQueue = nativeQueue.catch(() => {}).then(async () => {
      if (current === epoch) await action();
    });
    return nativeQueue;
  }
  const busy = computed(() => state.value.phase !== 'IDLE' && state.value.phase !== 'ENDED');
  const ready = computed(() => manager.value !== null && startupComplete.value);
  const canCall = computed(
    () => enabled.value && supported.value && ready.value && !busy.value,
  );
  const relayKey = () => `mourn_calls_relay_${accountId}`;
  function setAlwaysRelay(value: boolean) {
    alwaysRelay.value = value;
    try {
      if (accountId) localStorage.setItem(relayKey(), String(value));
    } catch {
      /* ephemeral setting */
    }
  }
  async function initialize(userId: string, deviceId: string) {
    const stopped = destroy({ accountBoundary: !!lastAccountId && lastAccountId !== userId });
    const current = epoch;
    await stopped;
    if (current !== epoch) return;
    accountId = userId;
    lastAccountId = userId;
    supported.value = browserMediaSupport().available && mobilePlatform() !== 'ios';
    try {
      alwaysRelay.value = localStorage.getItem(relayKey()) === 'true';
      const alerts = JSON.parse(localStorage.getItem(`mourn_calls_alerts_${accountId}`) || '{}') as { ringtone?: unknown; vibrate?: unknown };
      ringtone.value = alerts.ringtone === 'silent' ? 'silent' : 'system';
      vibrate.value = alerts.vibrate !== false;
    } catch {
      alwaysRelay.value = false;
    }
    let nativePreparation: Promise<void> | null = null;
    let nativeCallId: string | null = null;
    let notifiedId: string | null = null;
    const next: CallManager = new CallManager({
      api: callsApi,
      transport: transport ?? unavailableTransport,
      userId,
      localDeviceId: deviceId,
      prepareMedia: async () => {
        if (current !== epoch || !android || !next.call) return;
        if (!nativePreparation || nativeCallId !== next.call.id) {
          nativeCallId = next.call.id;
          const id = nativeCallId;
          nativePreparation = (async () => {
            const permission = await AndroidCalls.requestMicPermission();
            if (!permission.granted) throw new Error('MIC_PERMISSION_DENIED');
            if (current !== epoch || !next.busy || next.call?.id !== id) return;
            await AndroidCalls.startCallService({ callId: id, userInitiated: true });
          })();
        }
        await nativePreparation;
      },
      releaseMedia: async () => {
        if (!android) return;
        const id = nativeCallId;
        const preparation = nativePreparation;
        // Do not hold logout behind an OS permission prompt. The epoch/busy
        // checks prevent a late grant from starting a service; stopCallService
        // also cancels an already-pending native start for this captured id.
        void preparation?.catch(() => {});
        if (nativePreparation === preparation) {
          nativePreparation = null;
          nativeCallId = null;
        }
        if (id && (current === epoch || !manager.value)) await AndroidCalls.stopCallService({ callId: id });
      },
      createMedia: (events) =>
        new BrowserMedia({
          alwaysRelay: sessionRelay.value,
          micDeviceId: micDeviceId.value,
          events, 
        }),
      onStats: value => { if (current === epoch) stats.value = value; },
      onChange: (nextState, nextCall) => {
        if (current !== epoch) return;
        if (
          ['IDLE', 'ENDED'].includes(state.value.phase) &&
          ['DIALING', 'RINGING'].includes(nextState.phase)
        ) {
          stats.value = null;
          sessionRelay.value = alwaysRelay.value;
          minimized.value = false;
        }
        state.value = nextState;
        call.value = nextCall;
        if (!android) return;
        if (nextState.phase === 'RINGING' && nextCall && notifiedId !== nextCall.id) {
          notifiedId = nextCall.id;
          const id = nextCall.id;
          void AndroidCalls.showIncoming({
            callId: id,
            linkId: nextCall.linkId,
            callerDeviceId: nextCall.callerDeviceId,
            expiresAt: nextCall.ringExpiresAt,
          })
            .then(() => {
              if (current === epoch && (state.value.phase !== 'RINGING' || call.value?.id !== id))
                void AndroidCalls.cancelIncoming({ callId: id }).catch(() => {});
            })
            .catch(() => {});
        } else if (nextState.phase !== 'RINGING' && notifiedId) {
          const id = notifiedId;
          notifiedId = null;
          void AndroidCalls.cancelIncoming({ callId: id }).catch(() => {});
        }
      },
      onEnded: () => {
        if (current === epoch) {
          muted.value = false;
          focusMuted = false;
          speaker.value = false;
          minimized.value = false;
        }
      },
    });
    managers.add(next);
    manager.value = next;
    await refreshConfig();
    // Boot explicitly discards interrupted calls once, after signal handlers are attached.
  }
  async function refreshConfig() {
    const current = epoch;
    const active = manager.value;
    if (!active || !accountId) return;
    const request = ++configRevision;
    try {
      const config = await callsApi.config();
      if (current !== epoch || request !== configRevision || active !== manager.value) return;
      enabled.value = config.enabled && config.protocolVersion === 1 && config.signallingPolicy === 'memory-only-v1';
      await active.setEnabled(enabled.value && supported.value);
      if (android) await nativeFor(current, async () => {
        if (request === configRevision && active === manager.value) await AndroidCalls.setIncomingEnabled(nativeEligibility(enabled.value && supported.value));
      });
    } catch {
      if (current === epoch && request === configRevision && active === manager.value) {
        enabled.value = false;
        await active.setEnabled(false);
        if (android) await nativeFor(current, async () => {
          if (request === configRevision && active === manager.value) await AndroidCalls.setIncomingEnabled({ enabled: false });
        }).catch(() => {});
      }
    }
  }
  async function run(action: () => Promise<unknown>) {
    const current = epoch;
    error.value = null;
    try {
      await action();
    } catch {
      if (current === epoch)
        error.value = 'Call unavailable. Check your connection and device permissions.';
    }
  }
  async function dial(linkId: string) {
    const current = epoch;
    const active = manager.value;
    minimized.value = false;
    await run(async () => {
      await refreshConfig();
      if (current !== epoch || active !== manager.value) return;
      if (!canCall.value) throw new Error('UNAVAILABLE');
      await active!.dial(linkId);
    });
  }
  async function receiveSignal(body: CallBody) {
    const active = manager.value;
    if (!active) throw new Error('CALL_MANAGER_UNAVAILABLE');
    await active.signal(body);
  }
  async function discardInterruptedCalls() {
    const current = epoch;
    const active = manager.value;
    if (!active || startupComplete.value) return;
    await active.discardInterruptedCalls();
    if (current === epoch && active === manager.value) startupComplete.value = true;
  }
  async function receiveIncoming(callId: string) {
    const current = epoch;
    const active = manager.value;
    if (!active) return;
    await run(async () => {
      const incoming = await callsApi.get(callId);
      if (current === epoch) await active.incoming(incoming);
    });
  }
  async function receiveState(callId: string, hint?: { state: string; answeredDeviceId?: string | null; reason?: string | null }) {
    const current = epoch;
    const active = manager.value;
    if (!active) return;
    if (active.call?.id === callId && hint &&
      ['ENDED', 'MISSED', 'DECLINED', 'BUSY', 'CANCELLED', 'FAILED'].includes(hint.state)) {
      await active.event({ type: 'SERVER_STATE', callId, state: hint.state as ServerCallState,
        answeredDeviceId: null,
        reason: END_REASONS.includes(hint.reason as EndReason) ? hint.reason as EndReason : undefined,
      });
      return;
    }
    // A server hint may close a losing endpoint after REST access is withdrawn,
    // but never chooses the caller's winner, claims an answer or opens media.
    if (active.call?.id === callId && active.state.phase !== 'IDLE' &&
      active.state.role === 'callee' && hint?.state === 'ACTIVE' &&
      hint.answeredDeviceId && hint.answeredDeviceId !== active.state.localDeviceId) {
      await active.event({ type: 'SERVER_STATE', callId, state: 'ACTIVE', answeredDeviceId: hint.answeredDeviceId });
      return;
    }
    await run(async () => {
      const updated = await callsApi.get(callId);
      if (current === epoch) await active.serverState(updated);
    });
  }
  async function loadHistory(reset = false) {
    if (loading.value || (!reset && !hasMore.value)) return;
    loading.value = true;
    const current = epoch;
    const request = ++loadingEpoch;
    try {
      const page = await callsApi.history(reset ? undefined : (cursor ?? undefined));
      if (current !== epoch || request !== loadingEpoch) return;
      const rows = reset ? [] : history.value;
      history.value = [...new Map([...rows, ...page.calls].map((row) => [row.id, row])).values()];
      cursor = page.nextCursor;
      hasMore.value = page.hasMore;
    } catch {
      if (current === epoch) error.value = 'Could not load call history.';
    } finally {
      if (current === epoch && request === loadingEpoch) loading.value = false;
    }
  }
  async function clearHistory(id?: string) {
    const current = epoch;
    await run(async () => {
      await callsApi.clearHistory(id);
      if (current !== epoch) return;
      // Read the authoritative target, not just an optimistic deletion.
      loadingEpoch++;
      loading.value = false;
      await loadHistory(true);
    });
  }
  function toggleMute() {
    if (!['CONNECTING', 'ACTIVE', 'RESTARTING'].includes(state.value.phase)) return;
    muted.value = !muted.value;
    manager.value?.setMuted(muted.value || focusMuted);
    if (android && call.value)
      void AndroidCalls.setMuted({ callId: call.value.id, muted: muted.value || focusMuted }).catch(() => {});
  }
  function audioFocusChanged(focus: string) {
    if (!busy.value) return;
    if (focus === 'loss') { void manager.value?.hangup(); return; }
    if (!['gain', 'loss-transient', 'duck'].includes(focus)) return;
    focusMuted = focus !== 'gain';
    manager.value?.setMuted(muted.value || focusMuted);
    if (android && call.value)
      void AndroidCalls.setMuted({ callId: call.value.id, muted: muted.value || focusMuted }).catch(() => {});
  }
  async function nativeServiceChanged(callId: string, serviceState: string) {
    if (call.value?.id !== callId || !busy.value || !['error', 'stopped'].includes(serviceState)) return;
    await run(async () => { await manager.value?.hangup(); });
  }
  async function toggleSpeaker() {
    if (!android || !call.value) return;
    const next = !speaker.value;
    const current = epoch;
    const id = call.value.id;
    try {
      await AndroidCalls.setAudioRoute({
        callId: call.value.id,
        route: next ? 'speaker' : 'earpiece',
      });
      if (current === epoch && call.value?.id === id) speaker.value = next;
    } catch {
      if (current === epoch && call.value?.id === id) error.value = 'Audio route unavailable.';
    }
  }
  function destroy(options: { accountBoundary?: boolean } = {}): Promise<void> {
    epoch++;
    startupComplete.value = false;
    loadingEpoch++;
    const previous = manager.value;
    manager.value = null;
    if (previous) managers.delete(previous);
    state.value = { phase: 'IDLE' };
    call.value = null;
    history.value = [];
    cursor = null;
    hasMore.value = false;
    loading.value = false;
    enabled.value = false;
    error.value = null;
    muted.value = false;
    focusMuted = false;
    minimized.value = false;
    accountId = '';
    micDeviceId.value = '';
    microphones.value = [];
    microphoneLoading.value = false;
    microphoneError.value = null;
    ringtone.value = 'system';
    vibrate.value = true;
    if (options.accountBoundary) lastAccountId = '';
    if (android && previous?.call)
      void AndroidCalls.cancelIncoming({ callId: previous.call.id }).catch(() => {});
    speaker.value = false;
    stats.value = null;
    const closing = previous?.logout() ?? Promise.resolve();
    teardown = Promise.allSettled([teardown, closing]).then(async () => {
      if (android && options.accountBoundary) {
        // Serialize the boundary reset before any replacement account is enabled.
        nativeQueue = nativeQueue.catch(() => {}).then(() => AndroidCalls.resetCallState());
        await nativeQueue;
      }
    });
    return teardown;
  }
  return {
    state,
    call,
    enabled,
    supported,
    error,
    history,
    hasMore,
    loading,
    muted,
    speaker,
    stats,
    android,
    minimized,
    alwaysRelay,
    sessionRelay,
    ringtone,
    vibrate,
    micDeviceId,
    microphones,
    microphoneLoading,
    microphoneError,
    setRingtone,
    setVibrate,
    setMicrophone,
    loadMicrophones,
    busy,
    ready,
    canCall,
    initialize,
    destroy,
    refreshConfig,
    dial,
    receiveSignal,
    discardInterruptedCalls,
    announceReady: (callId: string) => manager.value?.announceReady(callId) ?? Promise.resolve(),
    peerReady: (callId: string, deviceId: string) => manager.value?.peerReady(callId, deviceId) ?? Promise.resolve(),
    receiveIncoming,
    receiveState,
    loadHistory,
    clearHistory,
    setAlwaysRelay,
    toggleMute,
    audioFocusChanged,
    nativeServiceChanged,
    toggleSpeaker,
    accept: () =>
      run(async () => {
        await manager.value?.accept();
      }),
    decline: () =>
      run(async () => {
        await manager.value?.decline();
      }),
    hangup: () =>
      run(async () => {
        await manager.value?.hangup();
      }),
    socketChanged: (connected: boolean) =>
      run(async () => {
        await manager.value?.event({ type: connected ? 'SOCKET_RESTORED' : 'SOCKET_LOST' });
      }),
    linkSevered: () =>
      run(async () => {
        await manager.value?.event({ type: 'LINK_SEVERED' });
      }),
    deviceRevoked: () =>
      run(async () => {
        await manager.value?.event({ type: 'DEVICE_REVOKED' });
      }),
  };
});

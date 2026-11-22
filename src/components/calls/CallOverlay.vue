<template>
  <aside
    v-if="calls.busy || (calls.state.phase === 'ENDED' && !dismissed)"
    class="call-overlay"
    :class="{ 'call-overlay--mini': minimized }"
    role="dialog"
    aria-label="Voice call"
    :aria-modal="!minimized"
    aria-live="polite"
  >
    <div class="row items-center justify-between q-gutter-sm">
      <strong><q-icon name="sym_o_call" /> {{ peerLabel }}</strong>
      <q-btn
        v-if="calls.busy && calls.state.phase !== 'RINGING'"
        flat
        dense
        :icon="minimized ? 'expand_more' : 'minimize'"
        :aria-label="minimized ? 'Expand call' : 'Minimize call'"
        @click="calls.minimized = !calls.minimized"
      />
      <q-btn v-else-if="!calls.busy" flat dense icon="close" aria-label="Dismiss call result" @click="dismiss" />
    </div>
    <div class="q-my-sm">
      {{ status }}<span v-if="calls.state.phase === 'ACTIVE'"> · {{ elapsed }}</span>
    </div>
    <template v-if="!minimized">
      <div class="call-security q-mb-md">
        <q-icon name="sym_o_lock" /> Encrypted voice ·
        {{ calls.sessionRelay ? 'Relay only' : 'Direct or relay' }}
      </div>
      <div v-if="calls.stats" class="call-security q-mb-md" role="status">
        Quality: {{ calls.stats.qualityBucket }} · {{ calls.stats.relayed ? 'Relay' : 'Direct' }}
        <span v-if="calls.stats.rttMs !== null"> · {{ Math.round(calls.stats.rttMs) }} ms RTT</span>
        <span v-if="calls.stats.lossPct !== null"> · {{ calls.stats.lossPct.toFixed(1) }}% loss</span>
        <span v-if="calls.stats.jitterMs !== null"> · {{ Math.round(calls.stats.jitterMs) }} ms jitter</span>
      </div>
      <div class="row justify-center q-gutter-sm">
        <template v-if="calls.state.phase === 'RINGING'">
          <q-btn
            outline
            color="negative"
            icon="call_end"
            label="Decline"
            @click="calls.decline()"
          />
          <q-btn color="positive" icon="call" label="Accept" @click="calls.accept()" />
        </template>
        <template v-else-if="calls.busy">
          <q-btn
            outline
            :icon="calls.muted ? 'mic_off' : 'mic'"
            :label="calls.muted ? 'Unmute' : 'Mute'"
            :aria-pressed="calls.muted"
            :disable="!['CONNECTING', 'ACTIVE', 'RESTARTING'].includes(calls.state.phase)"
            @click="calls.toggleMute()"
          />
          <q-btn
            v-if="calls.android"
            outline
            icon="volume_up"
            label="Speaker"
            :aria-pressed="calls.speaker"
            @click="calls.toggleSpeaker()"
          />
          <q-btn color="negative" icon="call_end" label="End" @click="calls.hangup()" />
        </template>
        <q-btn
          v-else-if="calls.enabled && calls.call"
          outline
          icon="call"
          label="Call again"
          @click="calls.dial(calls.call!.linkId)"
        />
      </div>
    </template>
  </aside>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useCallsStore } from 'src/stores/calls';
import { useLinksStore } from 'src/stores/links';
import { useAuthStore } from 'src/stores/auth';
import { endLabel, callDuration } from 'src/components/calls/presentation';
const calls = useCallsStore();
const links = useLinksStore();
const auth = useAuthStore();
const dismissed = ref(false);
const minimized = computed(() => calls.minimized && calls.state.phase !== 'RINGING');
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
let ringtone: HTMLAudioElement | null = null;
let vibrationTimer: ReturnType<typeof setInterval> | null = null;
function stopAlerts() {
  ringtone?.pause();
  ringtone?.removeAttribute('src');
  ringtone = null;
  if (vibrationTimer) {
    clearInterval(vibrationTimer);
    vibrationTimer = null;
    if (typeof navigator !== 'undefined') navigator.vibrate?.(0);
  }
}
const elapsed = computed(() => {
  return callDuration(calls.call ?? { answeredAt: null, endedAt: null }, now.value);
});
watch(
  () => calls.state.phase,
  (phase) => {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }

    if (phase === 'ACTIVE') {
      now.value = Date.now();
      ticker = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    }

  },
  { immediate: true },
);
watch(
  () => [calls.state.phase, calls.ringtone, calls.vibrate] as const,
  ([phase, sound, vibrate]) => {
    stopAlerts();
    if (phase !== 'RINGING' || calls.android) return;
    if (sound !== 'silent' && typeof Audio !== 'undefined') {
      ringtone = new Audio('/mourn_notification.mp3');
      ringtone.loop = true;
      ringtone.volume = 0.5;
      void ringtone.play().catch(() => {});
    }
    if (vibrate && typeof navigator !== 'undefined' && navigator.vibrate) {
      const pulse = () => navigator.vibrate([500, 300, 500]);
      pulse();
      vibrationTimer = setInterval(pulse, 2400);
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  if (ticker) clearInterval(ticker);
  stopAlerts();
});
const peerLabel = computed(() => {
  const link = links.links.find((row) => row.id === calls.call?.linkId);
  if (!link) return 'Voice call';
  const peer = link.senderId === auth.user?.id ? link.receiver : link.sender;
  return peer.profile?.displayName || peer.username;
});
const status = computed(() => {
  if (calls.error) return calls.error;
  const state = calls.state;
  if (state.phase === 'ENDED') return endLabel(state.reason, state.role === 'callee');
  return {
    IDLE: '',
    DIALING: 'Calling…',
    RINGING: 'Incoming voice call',
    ACCEPTING: 'Accepting…',
    CONNECTING: 'Connecting…',
    ACTIVE: 'Connected',
    RESTARTING: 'Reconnecting…',
  }[state.phase];
});
function dismiss() {
  dismissed.value = true;
  calls.error = null;
}
watch(
  () => calls.state.phase,
  () => {
    dismissed.value = false;
  },
);
</script>
<style scoped>
.call-overlay {
  position: fixed;
  z-index: 6500;
  bottom: max(76px, env(safe-area-inset-bottom));
  right: 16px;
  width: min(360px, calc(100vw - 32px));
  padding: 20px;
  color: rgb(var(--m-text-rgb));
  background: rgb(var(--m-surface-rgb));
  border: 1px solid rgb(var(--m-border-rgb));
  box-shadow: 0 8px 32px rgb(var(--m-bg-rgb) / 0.3);
  font-family: monospace;
}
.call-overlay:not(.call-overlay--mini) {
  inset: 0;
  width: 100%;
  height: 100dvh;
  box-sizing: border-box;
  padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow-y: auto;
}
.call-overlay--mini {
  padding: 12px;
  right: max(16px, env(safe-area-inset-right));
}
.call-security {
  color: rgb(var(--m-textMuted-rgb));
  font-size: 11px;
}
</style>

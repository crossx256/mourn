<template>
  <section aria-label="Call settings">
  <div class="coms-settings-row">
    <div class="coms-settings-label">
      <span>Always relay calls</span>
      <span class="coms-settings-desc"
        >Hide your IP address from your contact. May increase latency. Applies to the next
        call.</span
      >
    </div>
    <q-toggle
      :model-value="calls.alwaysRelay"
      aria-label="Always relay calls"
      @update:model-value="calls.setAlwaysRelay(Boolean($event))"
    />
  </div>
  <div class="coms-settings-row q-mt-md">
    <div class="coms-settings-label"><span>Ringtone</span><span class="coms-settings-desc">Android notification sound and vibration follow system call-channel settings.</span></div>
    <q-select :model-value="calls.ringtone" :options="ringtoneOptions" emit-value map-options dense outlined aria-label="Call ringtone" @update:model-value="calls.setRingtone($event)" />
  </div>
  <div class="coms-settings-row q-mt-md">
    <span>Vibrate for calls</span>
    <q-toggle :model-value="calls.vibrate" aria-label="Vibrate for calls" @update:model-value="calls.setVibrate(Boolean($event))" />
  </div>
  <div class="coms-settings-row q-mt-md">
    <div class="coms-settings-label"><span>Microphone</span><span class="coms-settings-desc">Applies to the next call. Device choices stay in memory for this session only.</span></div>
    <div class="row items-center no-wrap">
      <q-select :model-value="calls.micDeviceId" :options="[{ label: 'System default', value: '' }, ...(calls.microphones || [])]" :disable="calls.busy" emit-value map-options dense outlined aria-label="Call microphone" @popup-show="calls.loadMicrophones()" @update:model-value="calls.setMicrophone($event)" />
      <q-btn flat dense icon="refresh" aria-label="Refresh microphones" :loading="calls.microphoneLoading" :disable="calls.busy" @click="calls.loadMicrophones()" />
    </div>
  </div>
  <p v-if="calls.microphoneError" role="status" class="coms-settings-desc">{{ calls.microphoneError }}</p>
  <p class="coms-settings-desc q-mt-md">Call history is stored on your account until you delete it. Audio is never recorded.</p>
  </section>
</template>
<script setup lang="ts">
import { useCallsStore } from 'src/stores/calls';
const calls = useCallsStore();
const ringtoneOptions = [{ label: 'Default', value: 'system' }, { label: 'Silent', value: 'silent' }];
</script>
<style scoped>
.coms-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgb(var(--m-text-rgb));
  font-family: monospace;
}
.coms-settings-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.coms-settings-desc {
  font-size: 11px;
  color: rgb(var(--m-textMuted-rgb));
}
</style>

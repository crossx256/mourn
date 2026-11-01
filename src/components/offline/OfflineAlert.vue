<template>
  <q-dialog v-model="visible" position="standard">
    <div class="ofa-panel">
      <div class="ofa-head">
        <span class="ofa-title">[ offline mode ]</span>
        <button type="button" class="ofa-close" aria-label="close" @click="close">✕</button>
      </div>
      <div class="ofa-body">
        <p class="ofa-title-line">{{ title }}</p>
        <p class="ofa-message">{{ message }}</p>
        <label class="ofa-dnr">
          <input v-model="doNotShowAgain" type="checkbox" class="ofa-check" />
          <span>do not show again</span>
        </label>
      </div>
      <div class="ofa-foot">
        <button type="button" class="ofa-btn" @click="close">close</button>
      </div>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { isDismissed, dismissForever } from 'src/composables/useDismissable';

const props = defineProps<{
  /** Stable per-surface key used for the "do not show again" flag. */
  surface: string;
  title: string;
  message: string;
  /** True while the app is offline — gates whether the alert may appear. */
  active: boolean;
}>();
const emit = defineEmits<{ (e: 'close'): void }>();

const doNotShowAgain = ref(false);
const sessionHidden = ref(false);

// Show only when active, not forever-dismissed, and not hidden this session.
const visible = computed({
  get: () => props.active && !isDismissed(props.surface) && !sessionHidden.value,
  set: (v: boolean) => {
    if (!v) close();
  },
});

function close() {
  if (doNotShowAgain.value) {
    dismissForever(props.surface);
  }
  sessionHidden.value = true;
  emit('close');
}

// If the surface key changes (e.g. re-mount), reset the session-hidden so a new
// active period can surface the alert again.
watch(
  () => props.active,
  (active) => {
    if (!active) {
      sessionHidden.value = false;
      doNotShowAgain.value = false;
    }
  },
);
</script>

<style scoped>
.ofa-panel {
  width: min(460px, 90vw);
  background: #0a0a0a;
  border: 1px solid var(--primary, #ff0000);
  border-radius: 0;
  color: rgb(var(--m-arcText-rgb));
  font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
}

.ofa-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.ofa-title {
  font-size: 11px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: #ff0000;
}

.ofa-close {
  background: none;
  border: none;
  color: #555;
  font-size: 13px;
  cursor: pointer;
}
.ofa-close:hover {
  color: #ff0000;
}

.ofa-body {
  padding: 16px;
}

.ofa-title-line {
  font-size: 13px;
  letter-spacing: 0.1em;
  color: #ff0000;
  text-transform: uppercase;
  margin: 0 0 10px;
}

.ofa-message {
  font-size: 12px;
  line-height: 1.6;
  color: #999;
  margin: 0 0 16px;
}

.ofa-dnr {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #bbb;
  cursor: pointer;
}

.ofa-check {
  accent-color: #ff0000;
  width: 15px;
  height: 15px;
}

.ofa-foot {
  padding: 0 16px 16px;
  display: flex;
  justify-content: flex-end;
}

.ofa-btn {
  background: none;
  border: 1px solid var(--primary, #ff0000);
  color: #ff0000;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 7px 16px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ofa-btn:hover {
  background: rgba(255, 0, 0, 0.08);
}
</style>

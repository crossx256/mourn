<template>
  <div class="cap-captcha">
    <cap-widget
      v-if="ready && apiEndpoint"
      ref="widgetRef"
      required
      :data-cap-api-endpoint="apiEndpoint"
      data-cap-disable-haptics
      data-cap-hidden-field-name="captchaToken"
      @solve="onSolve"
      @error="onError"
      @reset="onReset"
    />
    <p v-if="errorMessage" class="cap-captcha__error" role="alert">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import type { CapWidget, CapSolveEvent, CapErrorEvent } from 'cap-widget';

declare global {
  interface Window {
    CAP_CUSTOM_WASM_URL?: string;
  }
}

const props = defineProps<{
  apiEndpoint: string;
}>();

const emit = defineEmits<{
  token: [token: string];
  error: [message: string];
}>();

const widgetRef = ref<CapWidget | null>(null);
const ready = ref(false);
const errorMessage = ref('');

function onSolve(event: Event) {
  const token = (event as CapSolveEvent).detail?.token?.trim() || '';
  errorMessage.value = '';
  emit('token', token);
}

function onError(event: Event) {
  const message =
    (event as CapErrorEvent).detail?.message || 'Captcha verification failed. Please try again.';
  errorMessage.value = message;
  emit('token', '');
  emit('error', message);
}

function onReset() {
  errorMessage.value = '';
  emit('token', '');
}

function reset() {
  widgetRef.value?.reset();
  onReset();
}

async function solve() {
  if (!widgetRef.value) throw new Error('Captcha is not ready');
  return widgetRef.value.solve();
}

function configureSelfHostedWasm(apiEndpoint: string) {
  const endpoint = new URL(apiEndpoint);
  const isLoopback = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1';
  if (endpoint.protocol !== 'https:' && !(import.meta.env.DEV && isLoopback)) {
    throw new Error('Captcha endpoint must use HTTPS');
  }

  window.CAP_CUSTOM_WASM_URL = new URL('/assets/cap_wasm_bg.wasm', endpoint.origin).toString();
}

defineExpose({ reset, solve });

onMounted(async () => {
  if (!props.apiEndpoint) {
    errorMessage.value = 'Captcha is not configured. Registration is temporarily unavailable.';
    emit('error', errorMessage.value);
    return;
  }

  try {
    configureSelfHostedWasm(props.apiEndpoint);
    await import('cap-widget');
    ready.value = true;
    await nextTick();
  } catch {
    errorMessage.value = 'Captcha failed to load. Refresh the page and try again.';
    emit('error', errorMessage.value);
  }
});
</script>

<style scoped>
.cap-captcha {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

cap-widget {
  --cap-background: var(--black);
  --cap-border-color: var(--white);
  --cap-border-radius: 0;
  --cap-checkbox-background: var(--black);
  --cap-checkbox-border: 1px solid var(--white);
  --cap-checkbox-border-radius: 0;
  --cap-color: var(--white);
  --cap-font: 'Courier New', 'Consolas', monospace;
  --cap-spinner-color: var(--primary);
  --cap-spinner-background-color: #333;
}

.cap-captcha__error {
  margin: 0;
  color: #ff6666;
  font:
    700 0.65rem/1.4 'Courier New',
    'Consolas',
    monospace;
  text-align: center;
}
</style>

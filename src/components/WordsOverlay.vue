<template>
  <div v-if="visible && quote" class="words-overlay-shell" :class="{ 'is-mobile': isMobile }">
    <section class="words-overlay-card" aria-live="polite">
      <div class="words-overlay-topline">
        <span class="">system</span>

        <button
          class="words-overlay-close"
          type="button"
          aria-label="dismiss quote"
          @click="dismiss"
        >
          [x]
        </button>
      </div>

      <div class="words-overlay-codeblock" role="note" aria-label="system quote">
        <pre class="words-overlay-content"><code>{{ quote.content }}</code></pre>
        <div class="words-overlay-fence--end">
          <!-- <span class="words-overlay-author">-system</span> -->
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from 'boot/axios';
import { useAppSettingsStore } from 'src/stores/appSettings';

type QuotePayload = {
  id: string;
  content: string;
  author: string;
};

const quote = ref<QuotePayload | null>(null);
const visible = ref(false);
const dismissed = ref(false);
const isMobile = ref(false);
const appSettingsStore = useAppSettingsStore();
let timerId: ReturnType<typeof setTimeout> | null = null;
const randomSystemMessagesEnabled = computed(() => appSettingsStore.randomSystemMessagesEnabled);

function randomFloat() {
  const buffer = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buffer);
    return (buffer[0] ?? 0) / 0xffffffff;
  }
  return Math.random();
}

function randomDelayMs() {
  const min = 1 * 60 * 1000;
  const max = 3 * 60 * 60 * 1000;
  return Math.floor(min + randomFloat() * (max - min));
}

async function fetchQuote() {
  if (dismissed.value || !randomSystemMessagesEnabled.value) return;

  try {
    const response = await api.get<QuotePayload>('/api/words/random');
    const payload = response.data;

    if (!payload?.id || !payload?.content || !randomSystemMessagesEnabled.value) return;

    quote.value = {
      id: payload.id,
      content: payload.content,
      author: payload.author || 'Anonymous',
    };
    visible.value = true;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Words overlay fetch failed', error);
    }
  }
}

function dismiss() {
  dismissed.value = true;
  visible.value = false;
}

function clearTimer() {
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
}

function scheduleQuoteFetch() {
  clearTimer();

  if (dismissed.value || !randomSystemMessagesEnabled.value) {
    return;
  }

  timerId = setTimeout(() => {
    void fetchQuote();
  }, randomDelayMs());
}

function syncViewportMode() {
  isMobile.value = window.matchMedia('(max-width: 700px)').matches;
}

onMounted(() => {
  syncViewportMode();
  window.addEventListener('resize', syncViewportMode, { passive: true });
  scheduleQuoteFetch();
});

watch(randomSystemMessagesEnabled, (enabled) => {
  if (!enabled) {
    clearTimer();
    visible.value = false;
    return;
  }

  scheduleQuoteFetch();
});

onBeforeUnmount(() => {
  clearTimer();
  window.removeEventListener('resize', syncViewportMode);
});
</script>

<style scoped>
.words-overlay-shell {
  position: fixed;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  z-index: 25;
  pointer-events: none;
}

.words-overlay-shell.is-mobile {
  left: 50%;
  bottom: 0.5rem;
  transform: translateX(-50%);
}

.words-overlay-card {
  width: min(560px, calc(100vw - 2rem));
  background: #000;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--dash-text);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
  padding: 0.7rem 0.78rem 0.75rem;
  pointer-events: auto;
  animation: wordsOverlayEnterBottom 300ms ease-out both;
}

.is-mobile .words-overlay-card {
  width: 100%;
}

.words-overlay-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: var(--primary);
  margin-bottom: 0.45rem;
}

.words-overlay-close {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dash-text);
  font-family: inherit;
  font-size: 0.8rem;
  letter-spacing: 0.12em;
  padding: 0;
  cursor: pointer;
}

.words-overlay-content {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.55;
  font-size: 0.83rem;
  letter-spacing: 0.02em;
  font-family: 'Courier New', 'Consolas', monospace;
  color: var(--dash-text);
}

.words-overlay-codeblock {
  /* border: 1px solid rgba(255, 255, 255, 0.08); */
  padding: 0.48rem 0.58rem 0.5rem;
  background: rgba(23, 0, 0, 0.68);
}

.words-overlay-fence--end {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  margin-top: 0.25rem;
}

.words-overlay-author {
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.5rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.78;
}

@keyframes wordsOverlayEnterBottom {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 700px) {
  .words-overlay-card {
    width: calc(100vw - 1.1rem);
  }
}
</style>

<template>
  <div class="group-chat-window">
    <div v-if="!activeChannel" class="group-chat-empty">
      <q-icon name="mdi-bullhorn-outline" size="48px" class="group-chat-empty-icon" />
      <span class="group-chat-empty-label">ANNOUNCEMENTS</span>
      <span class="group-chat-empty-sub">The Mourn announcement channel</span>
    </div>

    <template v-else>
      <div class="group-chat-header">
        <!-- Mobile only: the chat covers the whole viewport, so the header owns
             the way back to the conversation list (same affordance as the 1:1
             chat header's .vault-back-btn). -->
        <button
          v-if="isMobile"
          class="chat-mobile-back-btn"
          type="button"
          aria-label="Back to conversations"
          @click="emit('close')"
        >
          <q-icon name="mdi-arrow-left" size="16px" />
        </button>
        <div class="bc-header-left">
          <q-avatar size="36px" class="group-chat-avatar mourn-broadcast-avatar">
            <MournLogoInline class="mourn-broadcast-logo" />
          </q-avatar>
          <div class="group-chat-header-text">
            <span class="group-chat-header-name">{{ activeChannel.name }}</span>
            <span class="group-chat-header-meta">
              {{ activeChannel.memberCount }} MEMBERS · {{ muted ? 'MUTED' : 'LIVE' }}
            </span>
          </div>
        </div>
        <div class="bc-header-actions">
          <q-btn
            flat
            round
            dense
            :icon="muted ? 'mdi-bell-off-outline' : 'mdi-bell-outline'"
            size="sm"
            class="btn-secondary suite-header-button"
            @click="toggleMuted"
          >
            <q-tooltip class="font-mono text-[10px]">{{ muted ? 'Unmute' : 'Mute' }}</q-tooltip>
          </q-btn>
        </div>
      </div>

      <q-scroll-area ref="messagesScrollRef" class="group-chat-messages">
        <div v-if="broadcastStore.messagesLoading" class="group-chat-loading">
          <q-spinner color="primary" size="24px" />
        </div>
        <div v-else-if="broadcastStore.messages.length === 0" class="group-chat-empty-messages">
          <span class="group-chat-empty-messages-text">No announcements yet</span>
        </div>
        <div v-else class="group-chat-messages-list">
          <div
            v-for="message in broadcastStore.messages"
            :key="message.id"
            :data-msg-id="message.id"
            :class="['vault-msg', isOwn(message) ? 'vault-msg--sent' : 'vault-msg--recv']"
          >
            <q-avatar size="40px" class="vault-msg-avatar mourn-broadcast-avatar">
              <MournLogoInline class="mourn-broadcast-logo" />
            </q-avatar>
            <div class="vault-msg-body">
              <div class="vault-msg-meta">
                <span class="vault-msg-sender">{{ senderName(message) }}</span>
                <span class="vault-msg-time">{{ formatTime(message.createdAt) }}</span>
              </div>
              <div
                :class="[
                  'vault-msg-bubble',
                  isOwn(message) ? 'vault-msg-bubble--sent' : 'vault-msg-bubble--recv',
                ]"
              >
                <p class="group-message-text bc-message-text">{{ message.text }}</p>
              </div>
            </div>
          </div>
        </div>
      </q-scroll-area>

      <div class="group-chat-input">
        <div v-if="!canSend" class="group-chat-locked">
          <q-icon name="mdi-lock-outline" size="16px" />
          <span>Announcements are ADMIN ONLY</span>
        </div>
        <template v-else>
          <q-form class="group-chat-input-form" @submit.prevent="handleSend">
            <q-input
              ref="messageInputRef"
              v-model="draft"
              dense
              outlined
              dark
              type="textarea"
              autogrow
              rows="1"
              class="group-input-field"
              placeholder="Broadcast an announcement..."
              bg-color="transparent"
              hide-bottom-space
              autocomplete="off"
              :input-style="{ maxHeight: '120px', overflow: 'auto', resize: 'none' }"
              @keydown="onInputKeydown"
            />

            <button
              type="submit"
              class="group-send-btn bc-send-btn"
              :disabled="!draft.trim() || isSending"
            >
              <q-icon name="mdi-send" size="18px" />
            </button>
          </q-form>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { QScrollArea } from 'quasar';
import { useQuasar } from 'quasar';
import { useAuthStore } from 'src/stores/auth';
import { useVaultStore } from 'src/stores/vault';
import { useBroadcastStore, type BroadcastMessage } from 'src/stores/broadcastStore';
import MournLogoInline from 'src/components/icons/MournLogoInline.vue';
import { usePlatform } from 'src/composables/usePlatform';

const emit = defineEmits<{
  /** Mobile: return to the conversation list (the pane is full-screen there). */
  close: [];
}>();

const $q = useQuasar();
const { isMobile } = usePlatform();
const authStore = useAuthStore();
const vaultStore = useVaultStore();
const broadcastStore = useBroadcastStore();

const activeChannel = computed(() => broadcastStore.activeChannel);
const muted = computed(() => broadcastStore.muted);
const canSend = computed(() => broadcastStore.canSend);

const messagesScrollRef = ref<InstanceType<typeof QScrollArea> | null>(null);
const draft = ref('');
const isSending = ref(false);

function isOwn(message: BroadcastMessage): boolean {
  return message.senderId === authStore.user?.id || message.senderId === vaultStore.getStorageUid();
}

function senderName(message: BroadcastMessage): string {
  return isOwn(message) ? (authStore.user?.username ?? 'You') : 'Mourn';
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

async function scrollToBottom(animated = true) {
  await nextTick();
  messagesScrollRef.value?.setScrollPosition('vertical', 999999, animated ? 200 : 0);
}

watch(
  () => broadcastStore.messages.length,
  () => scrollToBottom(),
);

watch(
  () => broadcastStore.activeChannelSlug,
  () => scrollToBottom(false),
);

let memberCountPoll: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  broadcastStore.setViewing(true);
  await broadcastStore.ensureInit();
  await scrollToBottom(false);
  memberCountPoll = setInterval(() => void broadcastStore.fetchChannel(), 30_000);
});

onBeforeUnmount(() => {
  broadcastStore.setViewing(false);
  if (memberCountPoll) clearInterval(memberCountPoll);
});

async function handleSend() {
  const text = draft.value.trim();
  if (!text || isSending.value || !canSend.value) return;
  isSending.value = true;
  try {
    await broadcastStore.send(text);
    draft.value = '';
    await scrollToBottom();
  } catch (error) {
    console.error('[BroadcastChatWindow] Failed to broadcast:', error);
    $q.notify({
      type: 'negative',
      message: broadcastStore.lastError || 'Failed to broadcast announcement',
      position: 'bottom',
    });
  } finally {
    isSending.value = false;
  }
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void handleSend();
  }
}

async function toggleMuted() {
  const next = !muted.value;
  const ok = await broadcastStore.setMuted(next);
  if (!ok) {
    $q.notify({ type: 'negative', message: 'Failed to update mute state', position: 'bottom' });
    return;
  }
  $q.notify({
    type: 'positive',
    message: next ? 'Announcements muted.' : 'Announcements unmuted.',
    position: 'bottom',
  });
}
</script>

<style scoped>
.group-chat-window {
  --suite-composer-height: 44px;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #000;
}

.group-chat-empty,
.group-chat-empty-messages,
.group-chat-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.group-chat-empty-icon {
  color: #333;
}
.group-chat-empty-label,
.group-chat-empty-messages-text {
  color: rgb(var(--m-textDim-rgb));
  font: 600 13px monospace;
  letter-spacing: 0.1em;
}
.group-chat-empty-sub {
  color: #444;
  font: 11px monospace;
}

.group-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 61px;
  padding: 10px 16px;
  border-bottom: 1px solid #1a1a1a;
  background: #0c0c0c;
}
.bc-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  /* Keeps the channel identity beside the mobile back button instead of letting
     the header's `space-between` centre it between back and actions. */
  margin-right: auto;
}

/* Mobile back affordance — mirrors .vault-back-btn in MessagingPage (28px box,
   transparent, 1px border, muted glyph), using this component's own palette. */
.chat-mobile-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-right: 10px;
  flex-shrink: 0;
  color: rgb(var(--m-arcMuted-rgb));
  background: transparent;
  border: 1px solid #1a1a1a;
  cursor: pointer;
  transition: all 0.12s;
}

.chat-mobile-back-btn:hover {
  color: rgb(var(--m-text-rgb));
  border-color: rgb(var(--m-borderStrong-rgb));
  background: rgba(255, 255, 255, 0.04);
}

/* 28px visual box, ~44px touch target (an overlay, not a bigger button). */
@media (max-width: 1023px) {
  /* The composer must clear the Android gesture/navigation bar — viewport-fit=cover
     means the WebView extends underneath it, and Android reports
     env(safe-area-inset-bottom) as 0, so a fixed minimum does the work. */
  .group-chat-input-form {
    padding-bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  }

  .chat-mobile-back-btn {
    position: relative;
  }

  .chat-mobile-back-btn::after {
    content: '';
    position: absolute;
    inset: -8px;
  }
}
.bc-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.suite-header-button {
  width: 34px;
  min-width: 34px;
  height: 34px;
  min-height: 34px;
  padding: 0;
}
.group-chat-avatar {
  flex-shrink: 0;
  border: 1px solid #1a1a1a;
}
.mourn-broadcast-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #050505;
  color: rgb(var(--m-accent-rgb, 255 0 0));
}
.mourn-broadcast-logo {
  width: 70%;
}
.group-chat-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group-chat-header-name {
  color: rgb(var(--m-text-rgb));
  font: 600 13px monospace;
}
.group-chat-header-meta {
  color: rgb(var(--m-textDim-rgb));
  font: 10px monospace;
}

.group-chat-messages {
  flex: 1;
  min-height: 0;
}
.group-chat-empty-messages,
.group-chat-loading {
  height: 100%;
}
.group-chat-messages-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
}

.vault-msg {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 4px 0;
}
.vault-msg--sent {
  flex-direction: row-reverse;
}

.vault-msg-avatar {
  flex-shrink: 0;
  border: 1px solid #1a1a1a;
}
.vault-msg-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: min(72%, 720px);
}
.vault-msg--sent .vault-msg-body {
  align-items: flex-end;
}
.vault-msg-meta {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
  padding: 0 2px;
}
.vault-msg--sent .vault-msg-meta {
  justify-content: flex-end;
}
.vault-msg-sender {
  color: #aaa;
  font: 600 11px monospace;
}
.vault-msg-time {
  color: #555;
  font: 9px monospace;
}
.vault-msg-bubble {
  min-width: 72px;
  padding: 9px 12px;
  border: 1px solid #1d1d1d;
  background: #090909;
}
.vault-msg--sent .vault-msg-bubble {
  border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.34);
  background: color-mix(in srgb, rgb(var(--m-accent-rgb, 255 0 0) / 0.55) 66.6666666667%, color-mix(in srgb, black 55%, transparent));
}
.group-message-text {
  margin: 0;
  color: rgb(var(--m-text-rgb));
  font: 13px/1.45 monospace;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.group-chat-input {
  position: relative;
  flex-shrink: 0;
  border-top: 1px solid #1a1a1a;
  background: #0c0c0c;
}
.group-chat-locked {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: rgb(var(--m-textDim-rgb));
  font: 12px monospace;
}
.group-chat-input-form {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-height: var(--suite-composer-height);
  padding: 10px 16px 14px;
}
.group-send-btn {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: var(--suite-composer-height);
  height: var(--suite-composer-height);
  min-height: var(--suite-composer-height);
  border: 1px solid #1a1a1a;
  background: transparent;
  color: rgb(var(--m-arcMuted-rgb));
  cursor: pointer;
}
.group-send-btn:hover:not(:disabled) {
  border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.45);
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.08);
  color: rgb(var(--m-arcEncrypted-rgb));
}
.group-send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.group-input-field {
  flex: 1;
  min-width: 0;
}
:deep(.group-input-field .q-field__control) {
  min-height: var(--suite-composer-height) !important;
  padding: 0 12px !important;
  border: 1px solid #1a1a1a !important;
  border-radius: 0 !important;
  background: #111 !important;
}
:deep(.group-input-field .q-field__control::before),
:deep(.group-input-field .q-field__control::after) {
  display: none;
}
:deep(.group-input-field textarea.q-field__native) {
  box-sizing: border-box;
  min-height: calc(var(--suite-composer-height) - 2px) !important;
  padding: 10px 0 !important;
  color: rgb(var(--m-text-rgb));
  font: 13px/20px monospace;
}
</style>

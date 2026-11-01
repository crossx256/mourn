<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="vault-ctx-backdrop"
      @click="$emit('close')"
      @contextmenu.prevent="$emit('close')"
    />
    <div
      v-if="visible"
      class="vault-ctx-menu"
      :style="{ top: `${y}px`, left: `${x}px` }"
      @click.stop
    >
      <template v-if="mediaUrl">
        <button class="vault-ctx-item" type="button" @click="$emit('open-media', mediaUrl)">
          <q-icon name="mdi-open-in-new" size="14px" /> Open Link
        </button>
        <button class="vault-ctx-item" type="button" @click="$emit('copy-media-link', mediaUrl)">
          <q-icon name="mdi-link" size="14px" /> Copy Link
        </button>
        <template v-if="mediaType === 'image'">
          <button class="vault-ctx-item" type="button" @click="$emit('copy-image', mediaUrl)">
            <q-icon name="mdi-image-outline" size="14px" /> Copy Image
          </button>
          <button
            class="vault-ctx-item"
            type="button"
            @click="$emit('save-media', mediaUrl, 'image')"
          >
            <q-icon name="mdi-download" size="14px" /> Save Image
          </button>
        </template>
        <button
          v-else
          class="vault-ctx-item"
          type="button"
          @click="$emit('save-media', mediaUrl, 'video')"
        >
          <q-icon name="mdi-download" size="14px" /> Save Video
        </button>
      </template>

      <template v-else-if="message">
        <div v-if="canReact" class="vault-ctx-reactions">
          <button
            v-for="emoji in emojis.slice(0, 3)"
            :key="emoji"
            class="vault-ctx-emoji"
            type="button"
            @click="$emit('react', message.id, emoji)"
          >
            <img
              class="vault-emoji-icon"
              :src="emojiUrl(emoji)"
              :alt="emoji"
              loading="lazy"
              decoding="async"
            />
          </button>
          <button
            class="vault-ctx-emoji vault-ctx-emoji-plus"
            type="button"
            @click="$emit('open-picker', $event, message.id)"
          >
            <q-icon name="mdi-emoticon-plus-outline" size="16px" />
          </button>
        </div>
        <div v-if="canReact" class="vault-ctx-sep" />
        <button
          v-if="canReply"
          class="vault-ctx-item"
          type="button"
          @click="$emit('reply', message.id)"
        >
          <q-icon name="mdi-reply" size="14px" /> Reply
        </button>
        <button class="vault-ctx-item" type="button" @click="$emit('copy-text', message.id)">
          <q-icon name="mdi-content-copy" size="14px" /> Copy Text
        </button>
        <div class="vault-ctx-sep" />
        <button
          class="vault-ctx-item vault-ctx-item--report"
          type="button"
          @click="$emit('report', message.id)"
        >
          <q-icon name="mdi-alert-octagon-outline" size="14px" /> Report
        </button>
        <div class="vault-ctx-sep" />
        <button
          class="vault-ctx-item vault-ctx-item--danger"
          type="button"
          @click="$emit('delete-for-me', message.id)"
        >
          <q-icon name="mdi-delete-outline" size="14px" />
          {{ message.isOwn ? 'Delete (for me)' : 'Remove' }}
        </button>
        <button
          v-if="message.isOwn && canDeleteForEveryone"
          class="vault-ctx-item vault-ctx-item--danger"
          type="button"
          @click="$emit('delete-for-everyone', message.id)"
        >
          <q-icon name="mdi-delete" size="14px" /> Delete (for everyone)
        </button>
        <template v-if="showRefresh">
          <div class="vault-ctx-sep" />
          <button class="vault-ctx-item" type="button" @click="$emit('refresh')">
            <q-icon name="mdi-refresh" size="14px" /> Refresh
          </button>
        </template>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
export interface MessageContextTarget {
  id: string;
  isOwn: boolean;
}

withDefaults(
  defineProps<{
    visible: boolean;
    x: number;
    y: number;
    message: MessageContextTarget | null;
    mediaUrl?: string | null;
    mediaType?: 'image' | 'video' | null;
    emojis: readonly string[];
    emojiUrl: (emoji: string) => string;
    canReact?: boolean;
    canReply?: boolean;
    canDeleteForEveryone?: boolean;
    showRefresh?: boolean;
  }>(),
  {
    mediaUrl: null,
    mediaType: null,
    canReact: true,
    canReply: true,
    canDeleteForEveryone: true,
    showRefresh: true,
  },
);

defineEmits<{
  close: [];
  react: [messageId: string, emoji: string];
  'open-picker': [event: MouseEvent, messageId: string];
  reply: [messageId: string];
  'copy-text': [messageId: string];
  /** Opens the ticket composer pre-set to this message's conversation. */
  report: [messageId: string];
  'delete-for-me': [messageId: string];
  'delete-for-everyone': [messageId: string];
  refresh: [];
  'open-media': [url: string];
  'copy-media-link': [url: string];
  'copy-image': [url: string];
  'save-media': [url: string, mediaType: 'image' | 'video'];
}>();
</script>

<style scoped>
.vault-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
}
.vault-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  padding: 4px 0;
  border: 1px solid #1a1a1a;
  background: #0c0c0c;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
}
.vault-ctx-reactions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
}
.vault-ctx-emoji {
  display: flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  transition: background 0.1s;
}
.vault-ctx-emoji:hover {
  background: rgba(255, 255, 255, 0.08);
}
.vault-ctx-emoji-plus {
  color: rgba(255, 255, 255, 0.4);
}
.vault-ctx-emoji-plus:hover {
  color: rgba(255, 255, 255, 0.7);
}
.vault-emoji-icon {
  display: block;
  width: 18px;
  height: 18px;
}
.vault-ctx-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border: 0;
  background: none;
  color: rgb(var(--m-text-rgb));
  font: 12px monospace;
  cursor: pointer;
  transition: background 0.1s;
}
.vault-ctx-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.vault-ctx-item--danger {
  color: #f00;
}
.vault-ctx-item--danger:hover {
  background: rgba(255, 0, 0, 0.12);
}
/* Reporting is not destructive — amber, not crimson. */
.vault-ctx-item--report {
  color: rgb(var(--m-warning-rgb));
}
.vault-ctx-item--report:hover {
  background: rgba(255, 170, 0, 0.12);
}
.vault-ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: #1a1a1a;
}
</style>

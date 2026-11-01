<template>
  <transition name="vault-fade">
    <div v-if="visible" class="vault-reaction-bar">
      <button
        v-for="emoji in emojis.slice(0, 3)"
        :key="emoji"
        type="button"
        class="vault-reaction-bar-btn"
        @click.stop="$emit('react', emoji)"
      >
        <img
          v-if="emojiUrl"
          class="vault-emoji-icon"
          :src="emojiUrl(emoji)"
          :alt="emoji"
          loading="lazy"
          decoding="async"
        />
        <span v-else>{{ emoji }}</span>
      </button>
      <button
        type="button"
        class="vault-reaction-bar-btn vault-reaction-bar-plus"
        @click.stop="$emit('open-picker', $event)"
      >
        <q-icon name="mdi-emoticon-plus-outline" size="16px" />
      </button>
    </div>
  </transition>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  emojis: readonly string[];
  emojiUrl?: (emoji: string) => string;
}>();

defineEmits<{
  react: [emoji: string];
  'open-picker': [event: MouseEvent];
}>();
</script>

<style scoped>
.vault-emoji-icon {
  display: block;
  width: 18px;
  height: 18px;
}
.vault-reaction-bar {
  position: absolute;
  top: -4px;
  left: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  background: #0c0c0c;
}
.vault-reaction-bar-btn {
  display: flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: none;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.1s;
}
.vault-reaction-bar-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}
.vault-reaction-bar-plus {
  color: rgba(255, 255, 255, 0.4);
}
.vault-reaction-bar-plus:hover {
  color: rgba(255, 255, 255, 0.7);
}
.vault-fade-enter-active,
.vault-fade-leave-active {
  transition: opacity 0.15s;
}
.vault-fade-enter-from,
.vault-fade-leave-to {
  opacity: 0;
}
</style>

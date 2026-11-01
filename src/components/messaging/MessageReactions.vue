<template>
  <div v-if="Object.keys(reactions).length > 0" class="vault-reactions">
    <button
      v-for="(actors, emoji) in reactions"
      :key="emoji"
      type="button"
      :class="[
        'vault-reaction-chip',
        { 'vault-reaction-chip--mine': actors.includes(currentActor) },
      ]"
      @click="$emit('toggle', emoji)"
    >
      <span class="vault-reaction-emoji">
        <img
          class="vault-emoji-icon vault-emoji-icon--sm"
          :src="messagingEmojiUrl(emoji)"
          :alt="emoji"
          loading="lazy"
          decoding="async"
        />
      </span>
      <span v-if="actors.length > 1" class="vault-reaction-count">{{ actors.length }}</span>
      <q-tooltip class="bg-black text-white text-xs font-mono">
        {{ actors.map((actor) => actorLabels[actor] || actor).join(', ') }}
      </q-tooltip>
    </button>
  </div>
</template>

<script setup lang="ts">
import { messagingEmojiUrl } from 'src/utils/messagingEmoji';

withDefaults(
  defineProps<{
    reactions: Record<string, string[]>;
    currentActor: string;
    actorLabels?: Record<string, string>;
  }>(),
  { actorLabels: () => ({}) },
);

defineEmits<{ toggle: [emoji: string] }>();
</script>

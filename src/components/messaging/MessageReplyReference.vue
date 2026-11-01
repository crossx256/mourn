<template>
  <button type="button" class="vault-reply-ref" @click="$emit('navigate', reference.id)">
    <q-icon name="mdi-reply" size="12px" class="vault-reply-ref-icon" />
    <span class="vault-reply-ref-name">{{ reference.sender }}</span>
    <span class="vault-reply-ref-text">{{ truncatedText }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MessageReplyReference } from 'src/types/messaging';

const props = withDefaults(
  defineProps<{
    reference: MessageReplyReference;
    maxLength?: number;
  }>(),
  { maxLength: 80 },
);

defineEmits<{ navigate: [messageId: string] }>();

const truncatedText = computed(() =>
  props.reference.text.length > props.maxLength
    ? `${props.reference.text.slice(0, props.maxLength)}…`
    : props.reference.text,
);
</script>

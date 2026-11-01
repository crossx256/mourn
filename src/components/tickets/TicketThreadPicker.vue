<template>
  <q-dialog :model-value="modelValue" persistent @update:model-value="onDialogToggle">
    <q-card class="thread-picker dialog-card">
      <q-card-section class="thread-picker-header">
        <div>
          <div class="thread-picker-title">select messages to include</div>
          <div class="thread-picker-subtitle">
            only the messages you check are sent with the report. unchecked messages are never
            included.
          </div>
        </div>
        <q-btn
          flat
          round
          dense
          icon="mdi-close"
          aria-label="close message selection"
          class="thread-picker-close"
          @click="cancel"
        />
      </q-card-section>

      <q-separator class="bg-dash-border" />

      <q-card-section class="thread-picker-toolbar">
        <span class="thread-picker-count">
          {{ selectedIds.length }} of {{ messages.length }} selected
        </span>
        <div class="thread-picker-toolbar-actions">
          <q-btn flat dense label="select all" class="thread-picker-btn" @click="selectAll" />
          <q-btn flat dense label="select none" class="thread-picker-btn" @click="selectNone" />
        </div>
      </q-card-section>

      <q-separator class="bg-dash-border" />

      <q-card-section class="thread-picker-body">
        <div v-if="messages.length === 0" class="thread-picker-empty">
          no loaded messages in this conversation.
        </div>

        <label
          v-for="message in messages"
          :key="message.id"
          class="thread-picker-row"
          :class="{ 'thread-picker-row--on': isSelected(message.id) }"
        >
          <q-checkbox
            :model-value="isSelected(message.id)"
            dense
            color="primary"
            @update:model-value="toggle(message.id)"
          />
          <span class="thread-picker-meta">
            <span class="thread-picker-sender">{{ message.senderLabel }}</span>
            <span class="thread-picker-time">{{ formatTime(message.timestamp) }}</span>
          </span>
          <span class="thread-picker-text">{{ message.plaintext }}</span>
        </label>
      </q-card-section>

      <q-separator class="bg-dash-border" />

      <q-card-actions class="thread-picker-actions">
        <q-btn
          unelevated
          dense
          icon="mdi-check"
          :label="`use ${selectedIds.length} message${selectedIds.length === 1 ? '' : 's'}`"
          class="thread-picker-confirm"
          :disable="selectedIds.length === 0"
          @click="confirm"
        />
        <q-btn flat dense label="cancel" class="thread-picker-btn" @click="cancel" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

export interface ThreadPickerMessage {
  id: string;
  plaintext: string;
  timestamp: number;
  /** Display name for the sender ("you" for the reporter's own messages). */
  senderLabel: string;
}

const props = defineProps<{
  modelValue: boolean;
  messages: ThreadPickerMessage[];
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  /** Ids of the checked messages, in the order they were displayed. */
  (event: 'confirm', selectedIds: string[]): void;
  (event: 'cancel'): void;
}>();

// Default: everything checked (§7.3), reset each time the picker opens.
const selected = ref<string[]>([]);

watch(
  () => props.modelValue,
  (open) => {
    if (open) selected.value = props.messages.map((message) => message.id);
  },
  { immediate: true },
);

const selectedIds = computed(() => selected.value);

function isSelected(id: string): boolean {
  return selected.value.includes(id);
}

function toggle(id: string) {
  selected.value = isSelected(id)
    ? selected.value.filter((current) => current !== id)
    : [...selected.value, id];
}

function selectAll() {
  selected.value = props.messages.map((message) => message.id);
}

function selectNone() {
  selected.value = [];
}

function onDialogToggle(open: boolean) {
  if (!open) cancel();
  else emit('update:modelValue', true);
}

function cancel() {
  emit('update:modelValue', false);
  emit('cancel');
}

function confirm() {
  // Emit in display order so the delimited text reads chronologically.
  const ordered = props.messages
    .filter((message) => isSelected(message.id))
    .map((message) => message.id);
  emit('confirm', ordered);
  emit('update:modelValue', false);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}
</script>

<style scoped>
.thread-picker {
  width: min(680px, 94vw);
  max-width: 94vw;
  border: 1px solid var(--dash-border);
  border-radius: 0;
  background: var(--dash-card);
  font-family: 'Courier New', monospace;
}

.thread-picker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.thread-picker-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--dash-text);
}

.thread-picker-subtitle {
  margin-top: 0.25rem;
  color: var(--dash-muted);
  font-size: 0.68rem;
  line-height: 1.5;
}

.thread-picker-toolbar,
.thread-picker-toolbar-actions,
.thread-picker-actions {
  display: flex;
  align-items: center;
}

.thread-picker-toolbar {
  justify-content: space-between;
  gap: 1rem;
}

.thread-picker-toolbar-actions,
.thread-picker-actions {
  gap: 0.4rem;
}

.thread-picker-count {
  color: var(--dash-muted);
  font-size: 0.7rem;
}

.thread-picker-body {
  max-height: 46vh;
  overflow-y: auto;
  padding: 0;
}

.thread-picker-empty {
  padding: 2rem 1rem;
  color: var(--dash-muted);
  font-size: 0.75rem;
  text-align: center;
}

.thread-picker-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.55rem 0.9rem;
  border-bottom: 1px solid var(--dash-border);
  cursor: pointer;
}

.thread-picker-row:last-child {
  border-bottom: none;
}

.thread-picker-row--on {
  background: var(--dash-bg);
}

.thread-picker-meta {
  display: flex;
  min-width: 132px;
  flex-direction: column;
  gap: 0.1rem;
  font-size: 0.66rem;
}

.thread-picker-sender {
  color: var(--dash-text);
}

.thread-picker-time {
  color: var(--dash-muted);
}

.thread-picker-text {
  flex: 1;
  color: var(--dash-text);
  font-size: 0.72rem;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}

.thread-picker-btn,
.thread-picker-confirm,
.thread-picker-close {
  border-radius: 0 !important;
  font-family: 'Courier New', monospace;
  font-size: 0.7rem;
  text-transform: lowercase;
}

.thread-picker-btn {
  border: 1px solid var(--dash-border) !important;
  background: var(--dash-card) !important;
  color: var(--dash-text) !important;
}

.thread-picker-btn:hover {
  border-color: var(--primary) !important;
  color: var(--primary) !important;
}

.thread-picker-confirm {
  border: 1px solid var(--primary) !important;
  background: var(--primary) !important;
  color: var(--dash-text) !important;
}
</style>

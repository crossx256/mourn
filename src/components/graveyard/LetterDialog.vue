<template>
  <q-dialog
    :model-value="!!letter"
    @update:model-value="
      (v: boolean) => {
        if (!v) emit('close');
      }
    "
    transition-show="fade"
    transition-hide="fade"
  >
    <q-card
      v-if="letter"
      class="letter-dialog border border-solid border-[var(--dash-border)] rounded"
      style="
        background: var(--dash-panel);
        color: var(--dash-text);
        min-width: 340px;
        max-width: 480px;
      "
    >
      <!-- Header -->
      <q-card-section class="pb-1">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span v-if="letter.serialId" class="serial-id">
              #{{ padSerial(letter.serialId) }}
            </span>
            <span
              class="text-xs tracking-[0.2em] uppercase font-bold"
              style="color: var(--primary)"
            >
              {{ letter.alias }}
            </span>
          </div>
          <span class="text-xs" style="color: var(--dash-muted)">
            {{ formattedDate }}
          </span>
        </div>
      </q-card-section>

      <q-separator dark style="background: var(--dash-border)" />

      <!-- Content with red quotation marks -->
      <q-card-section class="py-5">
        <div class="letter-content-wrap">
          <span class="quote-mark quote-open">&ldquo;</span>
          <p
            class="text-sm leading-relaxed m-0 whitespace-pre-line inline"
            style="color: var(--dash-text)"
          >
            {{ letter.content }}
          </p>
          <span class="quote-mark quote-close">&rdquo;</span>
        </div>
      </q-card-section>

      <q-separator dark style="background: var(--dash-border)" />

      <!-- MENTIONS (comment-style list) -->
      <template v-if="letter.mentions && letter.mentions.length > 0">
        <q-card-section class="py-3">
          <span
            class="text-[10px] tracking-[0.2em] uppercase block mb-3 font-mono"
            style="color: var(--dash-muted)"
          >
            MENTIONS
          </span>
          <div class="mentions-list">
            <div
              v-for="mention in letter.mentions"
              :key="mention.id"
              class="mention-comment"
              @click="onTeleport(mention.id)"
            >
              <!-- Serial ID badge -->
              <div class="mention-avatar">
                <span v-if="mention.serialId" class="mention-serial"
                  >#{{ padSerial(mention.serialId) }}</span
                >
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                >
                  <circle cx="12" cy="8" r="4" fill="currentColor" />
                  <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="currentColor" />
                </svg>
              </div>
              <!-- Alias and content -->
              <div class="mention-body">
                <span class="mention-alias">{{ mention.alias }}</span>
                <p class="mention-content" v-if="getMentionContent(mention.id)">
                  <span class="mention-quote-open">&ldquo;</span>{{ getMentionContent(mention.id)
                  }}<span class="mention-quote-close">&rdquo;</span>
                </p>
              </div>
            </div>
          </div>
        </q-card-section>
        <q-separator dark style="background: var(--dash-border)" />
      </template>

      <!-- Actions -->
      <q-card-actions class="flex justify-between px-4 py-3">
        <button
          class="bg-transparent border border-solid border-[var(--dash-border)] text-xs tracking-[0.15em] uppercase px-4 py-2 rounded cursor-pointer transition-all duration-200 hover:border-[var(--primary)] hover:text-[var(--primary)]"
          style="color: var(--dash-muted)"
          @click="emit('mention', letter)"
        >
          mention
        </button>

        <!-- Only an APPROVED letter is reportable (§4c): a report is a policy
             review, deliberately separate from the graveyard approval queue. -->
        <button
          v-if="letter.status === 'APPROVED'"
          class="bg-transparent border border-solid border-[var(--dash-border)] text-xs tracking-[0.15em] uppercase px-4 py-2 rounded cursor-pointer transition-all duration-200 hover:border-[var(--dash-warning)] hover:text-[var(--dash-warning)]"
          style="color: var(--dash-muted)"
          @click="onReport"
        >
          report
        </button>

        <button
          class="bg-transparent border border-solid border-[var(--dash-border)] text-xs tracking-[0.15em] uppercase px-4 py-2 rounded cursor-pointer transition-all duration-200 hover:border-[var(--primary)] hover:text-[var(--primary)]"
          style="color: var(--dash-muted)"
          @click="emit('close')"
        >
          close
        </button>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { Letter } from 'src/types/graveyard';
import { useGraveyardStore } from 'src/stores/graveyard';
import { openTicketReport } from 'src/utils/ticketLinks';

const graveyardStore = useGraveyardStore();
const router = useRouter();

const props = defineProps<{
  letter: Letter | null;
}>();

const emit = defineEmits<{
  close: [];
  mention: [letter: Letter];
  teleport: [letterId: string];
}>();

/**
 * Hand the letter to the shared ticket composer. The server re-checks the
 * APPROVED status before writing the ticket, so a stale client can't report an
 * unapproved letter.
 */
function onReport() {
  const letter = props.letter;
  if (!letter || letter.status !== 'APPROVED') return;
  void openTicketReport(router, {
    targetType: 'letter',
    targetRef: letter.id,
    label: `Letter #${padSerial(letter.serialId ?? 0)}${letter.alias ? ` (${letter.alias})` : ''}`,
  });
}

function padSerial(id: number): string {
  return String(id).padStart(4, '0');
}

function onTeleport(letterId: string) {
  emit('close');
  emit('teleport', letterId);
}

function getMentionContent(mentionId: string): string {
  const found = graveyardStore.letters.find((l) => l.id === mentionId);
  if (!found) return '';
  return found.content.length > 100 ? found.content.slice(0, 100) + '…' : found.content;
}

const formattedDate = computed(() => {
  if (!props.letter) return '';
  const d = new Date(props.letter.createdAt);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
});
</script>

<style scoped>
/* Red quotation marks for main letter content */
.letter-content-wrap {
  position: relative;
}

.quote-mark {
  color: var(--primary);
  font-family: Georgia, 'Times New Roman', serif;
  user-select: none;
}

.quote-open {
  font-size: 32px;
  line-height: 0.5;
  vertical-align: top;
  margin-right: 2px;
}

.quote-close {
  font-size: 22px;
  line-height: 0.5;
  vertical-align: bottom;
  margin-left: 2px;
}

/* Mentions comment section */
.mentions-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mention-comment {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--dash-border);
  background: rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: all 0.2s;
}

.mention-comment:hover {
  border-color: var(--primary);
  background: rgba(255, 0, 0, 0.04);
}

.mention-avatar {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary);
  margin-top: 1px;
}

.mention-serial {
  color: var(--primary);
  font-family: 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  font-weight: bold;
}

.mention-body {
  flex: 1;
  min-width: 0;
}

.mention-alias {
  display: block;
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: 'Courier New', monospace;
}

.mention-content {
  margin: 3px 0 0;
  color: var(--dash-muted);
  font-size: 12px;
  line-height: 1.4;
  font-style: italic;
}

.mention-quote-open {
  color: var(--primary);
  font-family: Georgia, serif;
  font-size: 16px;
  line-height: 0.5;
  vertical-align: top;
  margin-right: 1px;
}

.mention-quote-close {
  color: var(--primary);
  font-family: Georgia, serif;
  font-size: 13px;
  line-height: 0.5;
  vertical-align: bottom;
  margin-left: 1px;
}

/* Serial ID in header */
.serial-id {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 10px;
  letter-spacing: 0.15em;
  color: var(--dash-muted);
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.serial-id:hover {
  opacity: 1;
}
</style>

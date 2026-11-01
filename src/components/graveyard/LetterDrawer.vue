<template>
  <!-- Overlay backdrop: dimmed, blurred, pixelated -->
  <transition name="glitch-fade">
    <div v-if="modelValue" class="terminal-backdrop" @click.self="emit('update:modelValue', false)">
      <!-- Terminal popup container -->
      <div class="terminal-popup" :class="{ 'glitch-in': glitchActive }">
        <!-- Scanline overlay -->
        <div class="scanlines" />

        <!-- Glitch color bars (appear during entrance) -->
        <div v-if="glitchActive" class="glitch-bars">
          <div class="glitch-bar glitch-bar--red" />
          <div class="glitch-bar glitch-bar--cyan" />
          <div class="glitch-bar glitch-bar--white" />
        </div>

        <!-- Terminal header -->
        <div class="terminal-header">
          <div class="terminal-title">
            <span class="terminal-prompt">&gt;_</span>
            <span class="terminal-label">LETTER</span>
          </div>
          <button class="terminal-close" @click="emit('update:modelValue', false)">[X]</button>
        </div>

        <!-- Scrollable terminal body -->
        <div class="terminal-body">
          <!-- The Covenant -->
          <div class="terminal-section">
            <div class="terminal-section-header">// I UNDERSTAND THAT :</div>
            <div v-for="(rule, i) in covenantRules" :key="i" class="covenant-rule">
              <span class="rule-index">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="rule-title">{{ rule.title }}</span>
              <div class="rule-body">{{ rule.body }}</div>
            </div>
          </div>

          <div class="terminal-divider">─────────────────────────────────────────</div>

          <!-- Cooldown gate -->
          <div v-if="cooldownEnabled && !graveyardStore.canSubmit" class="cooldown-gate">
            <p class="cooldown-label">▌ LETTER LOCKED ▐</p>
            <p class="cooldown-info">
              next letter available in <strong>{{ graveyardStore.cooldownFormatted }}</strong
              >.
            </p>
            <p class="cooldown-trust">we trust you are using this time to grow.</p>
          </div>

          <!-- Submission form -->
          <template v-else>
            <div class="letter-drawer-form">
              <label class="terminal-field-label">&gt; ALIAS</label>
              <q-input
                v-model="alias"
                outlined
                dark
                dense
                :maxlength="40"
                placeholder="Anonymous"
                class="mb-4"
                input-class="text-sm font-mono"
              />

              <label class="terminal-field-label">&gt; CONTENT</label>
              <q-input
                v-model="content"
                type="textarea"
                outlined
                dark
                :maxlength="500"
                placeholder="Speak into the void…"
                class="mb-2"
                input-class="text-sm font-mono"
                :rules="[
                  (v: string) => !!v.trim() || 'cannot send silence.',
                  (v: string) => v.trim().length >= 10 || 'at least 10 characters.',
                ]"
              />

              <div class="char-count">{{ content.trim().length }} / 500</div>

              <label class="terminal-field-label"
                >&gt; MENTION IDs
                <span class="optional-tag">(optional — e.g. 42 or 1,7,12)</span></label
              >
              <q-input
                v-model="mentionIdInput"
                outlined
                dark
                dense
                :maxlength="200"
                placeholder="letter numbers, comma-separated"
                class="mb-2"
                input-class="text-sm font-mono"
              />

              <!-- Mentioned letter previews -->
              <div v-if="mentionedLetters.length > 0" class="mention-previews">
                <div
                  v-for="ml in mentionedLetters"
                  :key="ml.id"
                  class="mention-block mention-block--compact"
                >
                  <div class="mention-block-header">
                    <span class="mention-label"
                      >#{{ padSerial(ml.serialId) }} — {{ ml.alias || 'Anonymous' }}</span
                    >
                    <button class="mention-remove" @click="removeMention(ml)">[X]</button>
                  </div>
                  <div class="mention-quote">
                    <span class="quote-open">&ldquo;</span>
                    <span class="mention-content">{{
                      ml.content.length > 80 ? ml.content.slice(0, 80) + '…' : ml.content
                    }}</span>
                    <span class="quote-close">&rdquo;</span>
                  </div>
                </div>
              </div>
              <div v-if="unresolvedTokens.length > 0" class="mention-hint mention-hint--warn">
                not found: {{ unresolvedTokens.join(', ') }}
              </div>
            </div>
          </template>
        </div>

        <!-- Submit button (fixed at bottom of terminal) -->
        <div v-if="!cooldownEnabled || graveyardStore.canSubmit" class="terminal-footer">
          <button
            class="terminal-submit"
            :class="{ 'terminal-submit--disabled': !canSubmit }"
            :disabled="!canSubmit || graveyardStore.submitting"
            @click="handleSubmit"
          >
            {{ graveyardStore.submitting ? '&gt; COMMITTING…' : '&gt; COMMIT' }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Letter } from 'src/types/graveyard';
import { useGraveyardStore } from 'src/stores/graveyard';

const graveyardStore = useGraveyardStore();

const props = defineProps<{
  modelValue: boolean;
  replyTo?: Letter | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [
    payload: { content: string; alias: string; mentionId?: string },
    onResult?: (success: boolean) => void,
  ];
}>();

const content = ref('');
const alias = ref('');
const mentionIdInput = ref('');
const glitchActive = ref(false);

// Parse comma-separated tokens from the input
const mentionTokens = computed(() => {
  const raw = mentionIdInput.value.trim();
  if (!raw) return [] as string[];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
});

// Resolve a single token to a Letter
function resolveToken(token: string): Letter | null {
  const num = parseInt(token, 10);
  if (!isNaN(num) && String(num) === token) {
    return graveyardStore.letters.find((l: Letter) => l.serialId === num) ?? null;
  }
  return graveyardStore.letters.find((l: Letter) => l.id === token) ?? null;
}

// All resolved letters (deduped)
const mentionedLetters = computed(() => {
  const seen = new Set<string>();
  const results: Letter[] = [];
  for (const token of mentionTokens.value) {
    const letter = resolveToken(token);
    if (letter && !seen.has(letter.id)) {
      seen.add(letter.id);
      results.push(letter);
    }
  }
  return results;
});

// Tokens that didn't resolve to any letter
const unresolvedTokens = computed(() => {
  return mentionTokens.value.filter((t) => !resolveToken(t));
});

function padSerial(id: number | null | undefined): string {
  if (!id) return '0000';
  return String(id).padStart(4, '0');
}

function removeMention(letter: Letter) {
  // Remove the token(s) that resolve to this letter from the input
  const remaining = mentionTokens.value.filter((t) => {
    const resolved = resolveToken(t);
    return resolved?.id !== letter.id;
  });
  mentionIdInput.value = remaining.join(', ');
}

const covenantRules = [
  {
    title: 'Notice',
    body: 'This is not a social media feed. It is a record.',
  },
  {
    title: 'Review',
    body: 'Every letter needs approval.',
  },
  {
    title: 'The 14-Day Lock',
    body: 'You get one entry every two weeks.',
  },
  {
    title: 'Permanence',
    body: 'Once approved, a letter belongs to the graveyard. There are no removals.',
  },
];

// Glitch entrance animation on open
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      content.value = '';
      alias.value = '';
      mentionIdInput.value = '';

      // Pre-fill mention from replyTo AFTER reset
      if (props.replyTo?.serialId) {
        mentionIdInput.value = String(props.replyTo.serialId);
      } else if (props.replyTo?.id) {
        mentionIdInput.value = props.replyTo.id;
      }

      // Refresh cooldown status from backend when opening
      void graveyardStore.fetchStatus();

      glitchActive.value = true;
      setTimeout(() => {
        glitchActive.value = false;
      }, 600);
    }
  },
);

// Also react if replyTo changes while drawer is already open
watch(
  () => props.replyTo,
  (letter) => {
    if (!props.modelValue) return;
    if (letter?.serialId) {
      mentionIdInput.value = String(letter.serialId);
    } else if (letter?.id) {
      mentionIdInput.value = letter.id;
    }
  },
);

const canSubmit = computed(() => content.value.trim().length >= 10);

// H7 fix: cooldown gate enabled
const cooldownEnabled = true;

// Security: strip actual HTML/script markup + control chars, but do NOT
// HTML-entity-encode quotes/apostrophes. Entity-encoding here baked `&#x27;`,
// `&quot;`, `&lt;`, `&gt;` into the stored letter and made letters unreadable.
// XSS is prevented at render time (every renderer uses Vue `{{ }}`, which
// escapes), and the backend strips tags again as defense-in-depth.
function sanitize(raw: string): string {
  return (
    String(raw)
      // NBSP and other typographic chars are fine and kept.
      .replace(/<\/?[a-zA-Z][^>]*>/g, '') // strip HTML/XML tag-like sequences
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .trim()
  );
}

function handleSubmit() {
  if (!canSubmit.value || graveyardStore.submitting) return;
  const safe = sanitize(content.value);
  const safeAlias = alias.value.trim() || 'Anonymous';

  // Resolve mentionId: prefer serialId (sends numeric string), fallback to UUID
  let mentionId = '';
  const raw = mentionIdInput.value.trim();
  if (raw) {
    mentionId = raw;
  } else if (props.replyTo?.serialId) {
    mentionId = String(props.replyTo.serialId);
  } else if (props.replyTo?.id) {
    mentionId = props.replyTo.id;
  }

  const payload: { content: string; alias: string; mentionId?: string } = {
    content: safe,
    alias: safeAlias,
  };
  if (mentionId) {
    payload.mentionId = mentionId;
  }

  // Pass a callback so parent can tell us when to close
  emit('submit', payload, (success: boolean) => {
    if (success) {
      emit('update:modelValue', false);
    }
    // On failure, stay open so user can see the error and retry
  });
}
</script>

<style scoped>
.terminal-backdrop {
  position: fixed;
  top: 64px;
  bottom: 48px;
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px) contrast(1.1);
  -webkit-backdrop-filter: blur(4px) contrast(1.1);
}

.terminal-popup {
  position: relative;
  width: 70%;
  max-width: 800px;
  height: 80%;
  max-height: calc(100vh - 64px - 48px - 40px);
  display: flex;
  flex-direction: column;
  background: var(--dash-bg);
  border: 1px solid var(--dash-border);
  box-shadow:
    0 0 40px rgba(255, 0, 0, 0.08),
    0 0 2px rgba(0, 255, 255, 0.15),
    inset 0 0 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  font-family: 'Courier New', 'Consolas', monospace;
}

.scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.06) 2px,
    rgba(0, 0, 0, 0.06) 4px
  );
}

.glitch-in {
  animation: glitchEntrance 0.5s steps(4) forwards;
}

@keyframes glitchEntrance {
  0% {
    opacity: 0;
    transform: translate(2px, -3px) skewX(-2deg);
    filter: hue-rotate(90deg) saturate(3);
  }
  15% {
    opacity: 1;
    transform: translate(-4px, 1px) skewX(1deg);
    filter: hue-rotate(-45deg) saturate(2);
  }
  30% {
    transform: translate(3px, -1px) skewX(-0.5deg);
    filter: hue-rotate(30deg) saturate(1.5);
  }
  50% {
    transform: translate(-1px, 2px) skewX(0.3deg);
    filter: none;
  }
  70% {
    transform: translate(1px, 0) skewX(0deg);
  }
  100% {
    opacity: 1;
    transform: none;
    filter: none;
  }
}

.glitch-bars {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  animation: glitchBarsOut 0.6s forwards;
}

@keyframes glitchBarsOut {
  0% {
    opacity: 1;
  }
  70% {
    opacity: 0.6;
  }
  100% {
    opacity: 0;
  }
}

.glitch-bar {
  position: absolute;
  width: 100%;
  animation: glitchBarSlide 0.4s steps(3) forwards;
}

.glitch-bar--red {
  height: 3px;
  top: 20%;
  background: rgba(255, 0, 0, 0.7);
  animation-delay: 0s;
}
.glitch-bar--cyan {
  height: 2px;
  top: 55%;
  background: rgba(0, 255, 255, 0.6);
  animation-delay: 0.08s;
}
.glitch-bar--white {
  height: 1px;
  top: 78%;
  background: rgba(255, 255, 255, 0.5);
  animation-delay: 0.15s;
}

@keyframes glitchBarSlide {
  0% {
    transform: translateX(-100%);
    opacity: 1;
  }
  40% {
    transform: translateX(10%);
    opacity: 0.8;
  }
  100% {
    transform: translateX(110%);
    opacity: 0;
  }
}

.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--dash-border);
  background: var(--dash-panel);
  flex-shrink: 0;
}

.terminal-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.terminal-prompt {
  color: var(--primary);
  font-size: 12px;
  font-weight: bold;
}
.terminal-label {
  color: var(--dash-text);
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.terminal-close {
  background: transparent;
  border: 1px solid var(--dash-border);
  color: var(--dash-muted);
  font-family: 'Courier New', monospace;
  font-size: 12px;
  cursor: pointer;
  padding: 8px 16px;
  transition: all 0.2s;
}

.terminal-close:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.terminal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  scrollbar-width: thin;
  scrollbar-color: var(--dash-border) transparent;
}

.terminal-body::-webkit-scrollbar {
  width: 6px;
}
.terminal-body::-webkit-scrollbar-track {
  background: transparent;
}
.terminal-body::-webkit-scrollbar-thumb {
  background: var(--dash-border);
  border-radius: 3px;
}

.terminal-section-header {
  color: var(--dash-muted);
  font-size: 10px;
  letter-spacing: 0.25em;
  margin-bottom: 12px;
}

.covenant-rule {
  margin-bottom: 10px;
  font-size: 12px;
  line-height: 1.5;
}
.rule-index {
  color: var(--primary);
  font-weight: bold;
  margin-right: 8px;
}
.rule-title {
  color: var(--dash-text);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.rule-body {
  color: var(--dash-muted);
  margin-top: 2px;
  padding-left: 28px;
  font-size: 11px;
}

.terminal-divider {
  color: var(--dash-border);
  font-size: 10px;
  margin: 16px 0;
  overflow: hidden;
  user-select: none;
}

.cooldown-gate {
  text-align: center;
  padding: 24px 0;
}
.cooldown-label {
  color: var(--primary);
  font-size: 12px;
  letter-spacing: 0.15em;
  margin-bottom: 8px;
}
.cooldown-info {
  color: var(--dash-muted);
  font-size: 12px;
}
.cooldown-info strong {
  color: var(--dash-text);
}
.cooldown-trust {
  color: var(--dash-muted);
  font-size: 10px;
  margin-top: 12px;
}

.terminal-field-label {
  display: block;
  color: var(--primary);
  font-size: 11px;
  letter-spacing: 0.2em;
  margin-bottom: 6px;
  font-family: 'Courier New', monospace;
}

.optional-tag {
  text-transform: none;
  letter-spacing: normal;
  color: var(--dash-muted);
}

.char-count {
  text-align: right;
  font-size: 11px;
  color: var(--dash-muted);
  margin-bottom: 16px;
  font-family: 'Courier New', monospace;
}

/* ── Mention previews ── */
.mention-previews {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  margin-bottom: 12px;
}

.mention-block {
  padding: 12px 16px;
  margin-top: 4px;
  margin-bottom: 16px;
  border: 1px solid var(--dash-border);
  background: var(--dash-panel);
  font-size: 12px;
}

.mention-block--compact {
  padding: 6px 10px;
  margin: 0;
  border: 1px solid var(--dash-border);
  background: var(--dash-panel);
  font-size: 11px;
}

.mention-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.mention-remove {
  background: transparent;
  border: none;
  color: var(--dash-muted);
  font-family: 'Courier New', monospace;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  transition: color 0.2s;
}

.mention-remove:hover {
  color: var(--primary);
}

.mention-label {
  display: block;
  color: var(--primary);
  letter-spacing: 0.1em;
  font-size: 10px;
  margin-bottom: 0;
}

.mention-quote {
  position: relative;
  padding: 4px 0 4px 4px;
}

.quote-open {
  color: var(--primary);
  font-size: 28px;
  line-height: 0.6;
  vertical-align: top;
  margin-right: 2px;
  font-family: Georgia, serif;
}

.quote-close {
  color: var(--primary);
  font-size: 20px;
  line-height: 0.6;
  vertical-align: bottom;
  margin-left: 2px;
  font-family: Georgia, serif;
}

.mention-content {
  color: var(--dash-text);
  font-style: italic;
}

.mention-alias {
  display: block;
  color: var(--dash-muted);
  margin-top: 6px;
}

.mention-hint {
  font-size: 10px;
  color: var(--dash-muted);
  font-family: 'Courier New', monospace;
  margin-top: 2px;
  margin-bottom: 16px;
  opacity: 0.6;
}

.mention-hint--warn {
  color: var(--primary);
  opacity: 0.7;
}

.terminal-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--dash-border);
  background: var(--dash-panel);
  flex-shrink: 0;
}

.terminal-submit {
  width: 100%;
  padding: 10px;
  background: transparent;
  border: 1px solid var(--primary);
  color: var(--primary);
  font-family: 'Courier New', monospace;
  font-size: 12px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;
}

.terminal-submit:hover:not(:disabled) {
  background: rgba(255, 0, 0, 0.1);
  box-shadow: 0 0 15px rgba(255, 0, 0, 0.2);
}

.terminal-submit--disabled {
  border-color: var(--dash-border);
  color: var(--dash-muted);
  cursor: not-allowed;
  opacity: 0.5;
}

.glitch-fade-enter-active {
  transition: opacity 0.15s ease;
}
.glitch-fade-leave-active {
  transition: opacity 0.25s ease;
}
.glitch-fade-enter-from,
.glitch-fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .terminal-popup {
    width: 95%;
    height: 85%;
  }
}
</style>

<!-- Unscoped overrides for Quasar input styling inside the terminal -->
<style>
.letter-drawer-form .q-field--outlined .q-field__control {
  border-color: var(--dash-border) !important;
  background: var(--dash-panel) !important;
}
.letter-drawer-form .q-field--outlined .q-field__control:hover {
  border-color: var(--dash-border-hover) !important;
}
.letter-drawer-form .q-field--outlined.q-field--focused .q-field__control {
  border-color: var(--primary) !important;
  box-shadow: 0 0 8px rgba(255, 0, 0, 0.15);
}
.letter-drawer-form .q-field__native,
.letter-drawer-form .q-field__input {
  color: var(--dash-text) !important;
  font-family: 'Courier New', monospace;
}
.letter-drawer-form .q-field__native::placeholder,
.letter-drawer-form .q-field__input::placeholder {
  color: var(--dash-muted) !important;
  opacity: 0.6;
}
</style>

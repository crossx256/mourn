<template>
  <!-- Graveyard Finder: Random Trip + Search. Rendered in the UI overlay layer.
       pointer-events-auto so clicks don't fall through to the 3D scene. -->
  <div class="grave-finder">
    <!-- ── Random Trip ── -->
    <button
      class="finder-trip"
      :disabled="!canTrip"
      title="Travel to a random letter"
      @click="randomTrip"
    >
      <span class="finder-trip-label">random trip</span>
    </button>

    <!-- ── Search ── -->
    <div class="finder-search" @focusin="focused = true" @focusout="onFocusOut" @keydown.esc="focused = false">
      <input
        ref="searchInput"
        v-model="query"
        class="finder-input"
        aria-label="Find a letter by alias or serial ID"
        type="text"
        placeholder="search alias / #id"
        :maxlength="60"
        @focus="focused = true"

        @keydown.enter.prevent="onEnter"

      />
      <!-- Results dropdown -->
      <div v-if="focused && results.length > 0" class="finder-results">
        <button type="button" v-for="r in results" :key="r.id" class="finder-result" @click="goTo(r)">
          <span class="finder-result-serial">#{{ padSerial(r.serialId) }}</span>
          <span class="finder-result-alias">{{ r.alias }}</span>
        </button>
      </div>
      <!-- No-match hint (only once user typed something) -->
      <div v-else-if="focused && query.length >= 2 && results.length === 0" class="finder-empty">
        no letters found
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGraveyardStore } from 'src/stores/graveyard';
import type { Letter } from 'src/types/graveyard';

const emit = defineEmits<{
  navigate: [letterId: string];
}>();

const graveyardStore = useGraveyardStore();

const query = ref('');
const focused = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);

/** Only navigate to letters the 3D scene can actually fly to (approved ones). */
const targets = computed<Letter[]>(() => graveyardStore.approvedLetters);
const canTrip = computed(() => targets.value.length > 0);

function padSerial(id: number | null): string {
  if (id == null) return '0000';
  return String(id).padStart(4, '0');
}

/** Matching by alias (substring, case-insensitive) OR by serial id. */
const results = computed<Letter[]>(() => {
  const q = query.value.trim().toLowerCase().replace(/^#/, '');
  if (!q) return [];
  const asNumber = /^\d+$/.test(q) ? Number(q) : null;
  return targets.value
    .filter((l) => {
      const aliasMatch = typeof l.alias === 'string' && l.alias.toLowerCase().includes(q);
      const idMatch = asNumber !== null && l.serialId === asNumber;
      // Also allow a zero-padded search like "0012" to resolve to serialId 12
      const paddedMatch =
        /^\d+$/.test(q) && l.serialId != null
          ? padSerial(l.serialId).toLowerCase().includes(q)
          : false;
      return aliasMatch || idMatch || paddedMatch;
    })
    .slice(0, 8);
});

function openSearch() {
  focused.value = true;
  searchInput.value?.focus();
}

function onEnter() {
  const first = results.value[0];
  if (first) {
    goTo(first);
  }
}

function onFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
    focused.value = false;
  }
}

function goTo(letter: Letter) {
  query.value = '';
  focused.value = false;
  emit('navigate', letter.id);
}

function randomTrip() {
  const pool = targets.value;
  if (pool.length === 0) return;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (!pick) return;
  query.value = '';
  focused.value = false;
  emit('navigate', pick.id);
}

defineExpose({ openSearch });
</script>

<style scoped lang="scss">
// Layer B tokens — this page (GraveyardPage) uses var(--dash-*). Keep one layer.
.grave-finder {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 220px;
  pointer-events: auto;
  color: var(--dash-text);
  font-family: 'Courier New', Consolas, monospace;
}

// ── Random Trip button (crimson, square, terminal feel) ──
.finder-trip {
  background: transparent;
  border: 1px solid var(--primary);
  color: var(--primary);
  padding: 10px 16px;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  font-size: 12px;
  font-family: inherit;
  font-weight: 300;
  cursor: pointer;
  border-radius: 0; // Mourn: never round corners
  transition:
    background 0.3s,
    color 0.3s;
  text-align: left;

  &:hover:not(:disabled) {
    background: rgba(255, 0, 0, 0.06);
  }

  &:active:not(:disabled) {
    background: rgba(255, 0, 0, 0.1);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

// ── Search ──
.finder-search {
  position: relative;
}

.finder-input {
  width: 100%;
  background: var(--dash-panel);
  border: 1px solid var(--dash-border);
  color: var(--dash-text);
  padding: 10px 12px;
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.05em;
  border-radius: 0;
  outline: none;
  transition: border-color 0.2s;

  &::placeholder {
    color: var(--dash-muted);
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 10px;
  }

  &:focus {
    border-color: var(--primary);
  }
}

.finder-results {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--dash-card);
  border: 1px solid var(--dash-border);
  z-index: 30;
  max-height: 240px;
  overflow-y: auto;
}

.finder-result {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--dash-border);
  color: var(--dash-text);
  padding: 8px 12px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;

  &:hover {
    background: rgba(255, 0, 0, 0.08);
  }

  &:last-of-type {
    border-bottom: none;
  }
}

.grave-finder :focus-visible {
  outline: 2px solid var(--dash-text);
  outline-offset: 3px;
}

.finder-result-serial {
  color: var(--primary);
  font-size: 11px;
  flex-shrink: 0;
}

.finder-result-alias {
  color: var(--dash-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.finder-empty {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--dash-card);
  border: 1px solid var(--dash-border);
  color: var(--dash-muted);
  font-size: 11px;
  padding: 10px 12px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  z-index: 30;
}
</style>

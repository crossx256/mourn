<template>
  <q-dialog v-model="visible" position="standard">
    <div class="mdl-panel">
      <!-- Header -->
      <header class="mdl-header">
        <span class="mdl-title">manage downloads</span>
        <button type="button" class="mdl-close" aria-label="close" @click="close">✕</button>
      </header>

      <!-- Context copy -->
      <p class="mdl-hint">
        downloading archives to this device allows for offline reading. everything is encrypted and
        readable only through the app.
      </p>

      <!-- Search (online) + toolbar -->
      <div class="mdl-search-row">
        <input
          v-model="search"
          type="text"
          class="mdl-search"
          placeholder="search archives…"
          @keydown.enter="onSearchSubmit"
        />
      </div>
      <div class="mdl-toolbar">
        <button type="button" class="mdl-btn mdl-btn-ghost" @click="toggleAll">
          {{ allSelected ? 'clear all' : 'select all' }}
        </button>
        <span class="mdl-count">{{ selected.size }} / {{ filteredArchives.length }} selected</span>
        <div class="mdl-toolbar-spacer" />
        <button
          type="button"
          class="mdl-btn mdl-btn-danger"
          :disabled="selected.size === 0 || busy"
          @click="downloadSelected"
        >
          download selected
        </button>
        <button type="button" class="mdl-btn mdl-btn-primary" :disabled="busy" @click="syncAll">
          {{ syncing ? 'syncing…' : 'download all / sync' }}
        </button>
      </div>

      <!-- Progress -->
      <div v-if="busy" class="mdl-progress">
        <span class="mdl-progress-text">{{ busyLabel }}</span>
      </div>

      <!-- Status / errors -->
      <div v-if="statusMsg" class="mdl-status" :class="statusIsError ? 'is-error' : 'is-ok'">
        {{ statusMsg }}
      </div>

      <!-- List -->
      <ul v-if="!loading" class="mdl-list">
        <li v-for="archive in filteredArchives" :key="archive.id" class="mdl-row">
          <label class="mdl-row-label">
            <input
              type="checkbox"
              class="mdl-check"
              :checked="selected.has(archive.slug)"
              :disabled="busy || savedSet.has(archive.slug)"
              @change="toggle(archive.slug)"
            />
            <span
              class="mdl-row-title"
              :class="archive.encrypted || !archive.isPublic ? 'is-blocked' : ''"
            >
              {{ archive.encrypted || !archive.isPublic ? '[ LOCKED ]' : archive.title }}
            </span>
          </label>

          <span v-if="savedSet.has(archive.slug)" class="mdl-row-meta" :class="'is-saved'">
            <span class="mdl-row-size">{{ formatSize(sizes[archive.slug] || 0) }}</span>
            <button
              type="button"
              class="mdl-row-del"
              :disabled="busy"
              aria-label="delete offline copy"
              @click="deleteOffline(archive.slug)"
            >
              ✕ del
            </button>
          </span>
          <button
            v-else
            type="button"
            class="mdl-row-tag mdl-btn mdl-btn-download"
            :disabled="busy || archive.encrypted || !archive.isPublic || !online"
            @click="downloadOne(archive.slug)"
          >
            download
          </button>
        </li>
      </ul>
      <div v-else class="mdl-loading">loading archives…</div>

      <div v-if="!loading && filteredArchives.length === 0" class="mdl-loading">
        {{ search ? 'no matching archives' : 'no archives available' }}
      </div>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useArchivesStore } from 'src/stores/archives';
import type { ArchiveListItem } from 'src/types/archives';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const archivesStore = useArchivesStore();

const selected = ref<Set<string>>(new Set());
const savedSet = ref<Set<string>>(new Set());
const sizes = ref<Record<string, number>>({});
const busy = ref(false);
const syncing = ref(false);
const busyLabel = ref('');
const statusMsg = ref('');
const statusIsError = ref(false);
const loading = ref(false);
const search = ref('');
const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const allArchives = computed<ArchiveListItem[]>(() => archivesStore.archives);

/** Search filter: title/slug, case-insensitive, applied client-side. */
const filteredArchives = computed<ArchiveListItem[]>(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return allArchives.value;
  return allArchives.value.filter(
    (a) => a.title.toLowerCase().includes(term) || a.slug.toLowerCase().includes(term),
  );
});

const allSelected = computed(
  () => filteredArchives.value.length > 0 && selected.value.size === filteredArchives.value.length,
);

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function close() {
  if (busy.value) return;
  emit('update:modelValue', false);
  selected.value = new Set();
  statusMsg.value = '';
  search.value = '';
}

function toggle(slug: string) {
  if (busy.value) return;
  const next = new Set(selected.value);
  if (next.has(slug)) next.delete(slug);
  else next.add(slug);
  selected.value = next;
}

function toggleAll() {
  if (busy.value) return;
  if (allSelected.value) {
    selected.value = new Set();
  } else {
    selected.value = new Set(
      filteredArchives.value.filter((a) => !a.encrypted && a.isPublic).map((a) => a.slug),
    );
  }
}

function onSearchSubmit() {
  // Already filtering reactively; keep focus in the dialog.
}

async function refresh() {
  loading.value = true;
  await archivesStore.fetchArchives(1);
  const saved = await archivesStore.listOfflineArchives();
  savedSet.value = new Set(saved);
  sizes.value = {};
  await Promise.all(
    saved.map(async (slug) => {
      sizes.value[slug] = await archivesStore.getOfflineArchiveSize(slug);
    }),
  );
  loading.value = false;
}

function report(result: { downloaded: string[]; failed: string[]; skipped: string[] }) {
  const parts: string[] = [];
  if (result.downloaded.length) parts.push(`${result.downloaded.length} saved`);
  if (result.skipped.length) parts.push(`${result.skipped.length} already saved`);
  if (result.failed.length) parts.push(`${result.failed.length} failed`);
  statusIsError.value = result.failed.length > 0;
  statusMsg.value =
    `done. ${parts.join(' — ')}.` + (result.failed.length ? ' (check connection or access)' : '');
  const nextSaved = new Set([...savedSet.value, ...result.downloaded, ...result.skipped]);
  savedSet.value = new Set(
    [...nextSaved].filter((s) => allArchives.value.some((a) => a.slug === s)),
  );
  void Promise.all(
    result.downloaded.map(async (slug) => {
      sizes.value[slug] = await archivesStore.getOfflineArchiveSize(slug);
    }),
  );
}

async function downloadSelected() {
  if (selected.value.size === 0 || busy.value) return;
  busy.value = true;
  busyLabel.value = `encrypting ${selected.value.size} selected…`;
  statusMsg.value = '';
  const slugs = [...selected.value];
  const result = await archivesStore.downloadArchivesOffline(slugs);
  report(result);
  selected.value = new Set();
  busy.value = false;
}

async function downloadOne(slug: string) {
  if (busy.value) return;
  busy.value = true;
  busyLabel.value = `downloading ${slug}…`;
  statusMsg.value = '';
  const result = await archivesStore.downloadArchivesOffline([slug]);
  report(result);
  busy.value = false;
}

async function deleteOffline(slug: string) {
  if (busy.value) return;
  busy.value = true;
  busyLabel.value = `removing offline copy…`;
  statusMsg.value = '';
  const res = await archivesStore.discardArchiveOffline(slug);
  if (res.success) {
    const next = new Set(savedSet.value);
    next.delete(slug);
    savedSet.value = next;
    selected.value.delete(slug);
    delete sizes.value[slug];
    statusIsError.value = false;
    statusMsg.value = 'offline copy removed.';
  } else {
    statusIsError.value = true;
    statusMsg.value = res.error || 'failed to remove the offline copy.';
  }
  busy.value = false;
}

async function syncAll() {
  if (busy.value) return;
  busy.value = true;
  syncing.value = true;
  busyLabel.value = 'syncing all archives…';
  statusMsg.value = '';
  const result = await archivesStore.syncAllOffline();
  report(result);
  syncing.value = false;
  busy.value = false;
}

function handleOnline() {
  online.value = true;
}
function handleOffline() {
  online.value = false;
}

onMounted(async () => {
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  await refresh();
});

onUnmounted(() => {
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) void refresh();
  },
);
</script>

<style scoped>
.mdl-panel {
  width: min(560px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: rgb(var(--m-elevated-rgb));
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 0;
  color: rgb(var(--m-arcText-rgb));
  font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
}

.mdl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.mdl-title {
  font-size: 11px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgb(var(--m-accent-rgb));
}

.mdl-close {
  background: none;
  border: none;
  color: rgb(var(--m-textFaint-rgb));
  font-size: 13px;
  cursor: pointer;
}
.mdl-close:hover {
  color: rgb(var(--m-accent-rgb));
}

.mdl-hint {
  margin: 12px 16px 8px;
  font-size: 11px;
  color: rgb(var(--m-arcMuted-rgb));
  letter-spacing: 0.05em;
  line-height: 1.6;
}

.mdl-search-row {
  padding: 0 16px 10px;
}
.mdl-search {
  width: 100%;
  background: rgb(var(--m-surface-rgb));
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0;
  color: rgb(var(--m-arcText-rgb));
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.05em;
  padding: 8px 10px;
  outline: none;
}
.mdl-search:focus {
  border-color: rgb(var(--m-accent-rgb));
}
.mdl-search::placeholder {
  color: rgb(var(--m-textFaint-rgb));
  text-transform: lowercase;
  letter-spacing: 0.1em;
}

.mdl-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px 12px;
  flex-wrap: wrap;
}

.mdl-toolbar-spacer {
  flex: 1;
}

.mdl-count {
  font-size: 10px;
  color: rgb(var(--m-textFaint-rgb));
  text-transform: lowercase;
  letter-spacing: 0.1em;
}

.mdl-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgb(var(--m-arcText-rgb));
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 7px 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.mdl-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.mdl-btn-ghost {
  color: rgb(var(--m-textMuted-rgb));
}
.mdl-btn-ghost:hover:not(:disabled) {
  border-color: rgb(var(--m-accent-rgb));
  color: rgb(var(--m-accent-rgb));
}
.mdl-btn-primary {
  border-color: rgb(var(--m-accent-rgb));
  color: rgb(var(--m-accent-rgb));
}
.mdl-btn-primary:hover:not(:disabled) {
  background: rgba(255, 0, 0, 0.08);
}
.mdl-btn-danger {
  border-color: rgba(255, 51, 51, 0.6);
  color: rgb(var(--m-arcEncrypted-rgb));
}
.mdl-btn-danger:hover:not(:disabled) {
  background: rgba(255, 0, 0, 0.08);
}
.mdl-btn-download {
  border-color: rgba(0, 255, 65, 0.5);
  color: #00ff41;
  font-size: 9px;
  padding: 4px 10px;
}
.mdl-btn-download:hover:not(:disabled) {
  background: rgba(0, 255, 65, 0.08);
}

.mdl-progress {
  padding: 0 16px 10px;
  font-size: 10px;
  color: rgb(var(--m-accent-rgb));
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.mdl-status {
  margin: 0 16px 10px;
  padding: 8px 10px;
  border: 1px solid;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: lowercase;
  line-height: 1.5;
}
.mdl-status.is-ok {
  border-color: rgba(0, 255, 65, 0.4);
  color: #00ff41;
}
.mdl-status.is-error {
  border-color: rgba(255, 51, 51, 0.5);
  color: #ff5555;
}

.mdl-list {
  list-style: none;
  margin: 0;
  padding: 0 16px 16px;
  overflow-y: auto;
  flex: 1;
}

.mdl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.mdl-row-label {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  min-width: 0;
}

.mdl-check {
  accent-color: rgb(var(--m-accent-rgb));
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.mdl-row-title {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: rgb(var(--m-arcText-rgb));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mdl-row-title.is-blocked {
  color: rgb(var(--m-textFaint-rgb));
  font-style: italic;
}

.mdl-row-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.mdl-row-meta.is-saved {
  color: #00ff41;
}

.mdl-row-size {
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: lowercase;
  color: rgb(var(--m-textMuted-rgb));
}

.mdl-row-del {
  background: none;
  border: 1px solid rgba(255, 51, 51, 0.5);
  color: #ff5555;
  font-family: inherit;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.mdl-row-del:hover:not(:disabled) {
  background: rgba(255, 0, 0, 0.1);
}
.mdl-row-del:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.mdl-loading {
  padding: 40px 16px;
  text-align: center;
  font-size: 10px;
  color: rgb(var(--m-textFaint-rgb));
  text-transform: uppercase;
  letter-spacing: 0.2em;
}
</style>

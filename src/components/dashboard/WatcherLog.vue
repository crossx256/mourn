<template>
  <q-card flat bordered dark class="dash-card mb-5" data-field="watcher-logs">
    <q-card-section>
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="dash-section-title">security log</div>
          <p class="text-xs text-muted m-0">
            <template v-if="watcherStore.watcherLevel === 3">
              cloud-synced &middot; max 50 entries
            </template>
            <template v-else-if="watcherStore.watcherLevel === 2">
              local device storage &middot; max {{ watcherStore.maxLocalEntries }} entries
            </template>
            <template v-else> watcher disabled &middot; no logs stored </template>
          </p>
        </div>
        <q-btn
          v-if="watcherStore.watcherLevel >= 2"
          unelevated
          class="bg-dash-card text-dash-text border border-solid border-dash-border"
          icon="mdi-refresh"
          label="refresh"
          dense
          size="sm"
          :loading="watcherStore.logsLoading"
          @click="refresh"
        />
      </div>

      <!-- Terminal-style log viewer -->
      <div v-if="watcherStore.watcherLevel >= 2" class="watcher-terminal">
        <!-- Loading -->
        <div
          v-if="watcherStore.logsLoading && watcherStore.logs.length === 0"
          class="p-4 text-muted"
        >
          intercepting signals...
        </div>

        <!-- Empty -->
        <div v-else-if="watcherStore.logs.length === 0" class="p-4 text-muted">
          no events recorded.
        </div>

        <!-- Entries -->
        <div v-else class="p-2">
          <div v-for="entry in watcherStore.logs" :key="entry.id" class="watcher-row">
            <!-- Timestamp -->
            <span class="watcher-ts">{{ formatTimestamp(entry.createdAt) }}</span>

            <!-- Status dot -->
            <span class="watcher-dot" :class="entry.success ? 'bg-dash-success' : 'bg-primary'" />

            <!-- Event type -->
            <span class="watcher-event" :class="eventColor(entry.eventType)">
              {{ entry.eventType }}
            </span>

            <!-- IP -->
            <span class="watcher-ip">
              {{ entry.ipAddress || '—' }}
            </span>

            <!-- Metadata snippet -->
            <span class="watcher-meta">
              {{ metaSnippet(entry.metadata) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Level 1 message -->
      <div v-else class="p-6 text-center text-muted text-sm">
        <q-icon name="mdi-shield-off-outline" size="32px" class="text-hellamuted mb-2" />
        <p class="m-0">watcher is disabled. select a protection level above to start logging.</p>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useWatcherStore } from 'src/stores/watcher';

const watcherStore = useWatcherStore();

onMounted(async () => {
  await watcherStore.loadLogs();
});

async function refresh() {
  await watcherStore.loadLogs();
}

function formatTimestamp(value: string) {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function eventColor(eventType: string) {
  if (
    eventType.includes('FAILURE') ||
    eventType.includes('BANNED') ||
    eventType.includes('LOCKOUT') ||
    eventType.includes('SUSPICIOUS')
  ) {
    return 'text-primary';
  }
  if (
    eventType.includes('SUCCESS') ||
    eventType.includes('GRANTED') ||
    eventType.includes('CREATED')
  ) {
    return 'text-dash-success';
  }
  if (eventType.includes('CHANGED') || eventType.includes('RESET')) {
    return 'text-dash-warning';
  }
  return 'text-dash-muted';
}

function metaSnippet(metadata?: Record<string, unknown> | null) {
  if (!metadata) return '';
  const details = metadata.details ?? metadata.reason ?? metadata.path ?? '';
  return (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 80);
}
</script>

<style scoped>
.watcher-terminal {
  background: #050505;
  border: 1px solid var(--dash-border);
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 12px;
  overflow-y: auto;
  height: 420px;
  scrollbar-width: thin;
  scrollbar-color: #1a1a1a #050505;
}

.watcher-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 3px 0;
  border-bottom: 1px solid #0a0a0a;
  transition: background 0.1s;
}
.watcher-row:hover {
  background: #0a0a0a;
}

.watcher-ts {
  color: #444;
  flex-shrink: 0;
  width: 140px;
}

.watcher-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
}

.watcher-event {
  flex-shrink: 0;
  width: 200px;
}

.watcher-ip {
  color: #555;
  flex-shrink: 0;
  width: 120px;
}

.watcher-meta {
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
</style>

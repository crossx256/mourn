<template>
  <q-page class="min-h-screen bg-dash-bg px-4 py-16 relative">
    <q-btn
      round
      flat
      icon="mdi-arrow-left"
      to="/"
      class="absolute left-4 top-4 text-primary z-10"
      aria-label="back to home"
    />

    <div class="tickets-shell">
      <header class="tickets-header">
        <h1 class="tickets-title">support &amp; reports</h1>
        <p class="tickets-subtitle">
          open a support ticket, or report a person, message, suite or graveyard star.
        </p>
        <q-separator class="bg-dash-border tickets-separator" />
      </header>

      <q-tabs v-model="tab" dense class="tickets-tabs" indicator-color="primary" align="left">
        <q-tab name="submit" label="submit a ticket" />
        <q-tab name="mine" label="my tickets" />
      </q-tabs>
      <q-separator class="bg-dash-border" />

      <q-tab-panels v-model="tab" animated class="tickets-panels bg-dash-bg">
        <q-tab-panel name="submit" class="tickets-panel">
          <q-card flat class="tickets-card">
            <q-card-section>
              <TicketComposer
                embedded
                :prefill="prefill"
                :initial-type="initialType"
                @submitted="onSubmitted"
                @view-mine="tab = 'mine'"
              />
            </q-card-section>
          </q-card>
        </q-tab-panel>

        <q-tab-panel name="mine" class="tickets-panel">
          <div class="tickets-mine-header">
            <span class="tickets-mine-count">
              {{ store.total }} ticket{{ store.total === 1 ? '' : 's' }}
            </span>
            <q-btn
              flat
              dense
              icon="mdi-refresh"
              label="refresh"
              class="tickets-secondary-btn"
              :loading="store.loading"
              @click="store.fetchMyTickets(store.page)"
            />
          </div>

          <div v-if="store.error" class="tickets-error" role="alert">
            <q-icon name="mdi-alert-outline" size="16px" />
            <span>{{ store.error }}</span>
          </div>

          <div v-if="store.loading" class="tickets-empty">loading your tickets…</div>

          <div v-else-if="store.myTickets.length === 0" class="tickets-empty">
            you haven't submitted any tickets yet.
          </div>

          <div v-else class="tickets-mine-list">
            <q-card
              v-for="ticket in store.myTickets"
              :key="ticket.id"
              flat
              class="tickets-mine-card"
            >
              <q-card-section class="tickets-mine-row">
                <span class="tickets-mine-ref">#{{ ticket.reference }}</span>
                <q-chip size="sm" :class="statusClass(ticket.status)" dense>
                  {{ ticket.status.replace(/_/g, ' ') }}
                </q-chip>
                <q-chip size="sm" class="tickets-mine-type" dense>{{ ticket.type }}</q-chip>
                <span class="tickets-mine-category">
                  {{
                    (ticket.customCategory
                      ? `Other: ${ticket.customCategory}`
                      : ticket.category
                    ).replace(/_/g, ' ')
                  }}
                </span>
                <span class="tickets-mine-target">{{ ticket.targetLabel || 'general' }}</span>
                <span class="tickets-mine-date">{{ formatDate(ticket.createdAt) }}</span>
              </q-card-section>
              <q-separator class="bg-dash-border" />
              <q-card-section class="tickets-mine-body">
                <p class="tickets-mine-description">{{ ticket.description }}</p>
                <div v-if="ticket.resolution" class="tickets-mine-resolution">
                  <span>resolution</span>
                  <p>{{ ticket.resolution }}</p>
                </div>
              </q-card-section>
            </q-card>
          </div>

          <div v-if="store.totalPages > 1" class="tickets-pagination">
            <q-btn
              flat
              dense
              icon="mdi-chevron-left"
              label="previous"
              class="tickets-secondary-btn"
              :disable="store.page <= 1 || store.loading"
              @click="store.fetchMyTickets(store.page - 1)"
            />
            <span>page {{ store.page }} of {{ store.totalPages }}</span>
            <q-btn
              flat
              dense
              icon-right="mdi-chevron-right"
              label="next"
              class="tickets-secondary-btn"
              :disable="store.page >= store.totalPages || store.loading"
              @click="store.fetchMyTickets(store.page + 1)"
            />
          </div>
        </q-tab-panel>
      </q-tab-panels>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import TicketComposer from 'src/components/tickets/TicketComposer.vue';
import { useTicketsStore } from 'src/stores/tickets';
import { getTicketMessagePrefill, clearTicketMessagePrefill } from 'src/utils/ticketLinks';
import type { TicketStatus, TicketTargetType, TicketType } from 'src/types/ticket';

const store = useTicketsStore();
const route = useRoute();

const tab = ref<'submit' | 'mine'>('submit');

/**
 * Deep-linkable pre-set target, so any surface can open the composer already
 * pointed at what the user clicked:
 *   /tickets?target=profile&ref=<userId>&label=@name
 *   /tickets?target=letter&ref=<letterId>
 *   /tickets?target=suite&ref=<groupId>
 *   /tickets?target=message&ref=<linkId>&prefill=<opaque token>
 * Message excerpts exist only in account-scoped memory until this page closes.
 * `scope=profile` narrows the category picker to the profile sub-categories.
 */
const prefill = computed(() => {
  const target = String(route.query.target ?? '');
  const ref = String(route.query.ref ?? '');
  if (!target || !ref) return null;
  if (!['message', 'suite', 'letter', 'profile'].includes(target)) return null;

  const label = route.query.label ? String(route.query.label) : undefined;
  const content = getTicketMessagePrefill(String(route.query.prefill ?? ''), target, ref);

  return {
    targetType: target as TicketTargetType,
    targetRef: ref,
    ...(label ? { label } : {}),
    ...(content ? { messageContent: content } : {}),
    ...(route.query.scope === 'profile' ? { categoryScope: 'profile' as const } : {}),
  };
});

/**
 * Deep-link type preselect, e.g. the nav's "report something" → /tickets?type=report.
 * Any pre-set target already implies a report, so `prefill` takes precedence.
 */
const initialType = computed<TicketType | null>(() => {
  const requested = String(route.query.type ?? '').toLowerCase();
  if (requested === 'report' || requested === 'support') {
    return prefill.value ? null : requested;
  }
  return null;
});

function statusClass(status: TicketStatus): string {
  if (status === 'resolved') return 'tickets-status tickets-status--resolved';
  if (status === 'in_progress') return 'tickets-status tickets-status--progress';
  return 'tickets-status tickets-status--pending';
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function onSubmitted() {
  clearTicketMessagePrefill();
  // Keep the confirmation visible in the composer; the user's list is already
  // updated optimistically by the store.
  void store.fetchMyTickets(1);
}

onMounted(() => {
  void store.fetchMyTickets(1);
});
onUnmounted(clearTicketMessagePrefill);
</script>

<style scoped>
.tickets-shell {
  max-width: 860px;
  margin: 0 auto;
  font-family: 'Courier New', monospace;
}

.tickets-header {
  margin-bottom: 1.25rem;
}

.tickets-title {
  margin: 0 0 0.35rem;
  color: var(--dash-text, #eeeeee);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: lowercase;
}

.tickets-subtitle {
  margin: 0;
  color: var(--dash-muted, #888888);
  font-size: 0.75rem;
}

.tickets-separator {
  margin-top: 1rem;
}

.tickets-tabs {
  color: var(--dash-muted, #888888);
  font-family: 'Courier New', monospace;
  font-size: 0.75rem;
  text-transform: lowercase;
}

.tickets-panels {
  background: transparent;
}

.tickets-panel {
  padding: 1.25rem 0;
}

.tickets-card {
  border: 1px solid var(--dash-border, #1a1a1a);
  border-radius: 0;
  background: var(--dash-card, #101010);
}

.tickets-mine-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.tickets-mine-count {
  color: var(--dash-muted, #888888);
  font-size: 0.72rem;
}

.tickets-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--primary, #ff0000);
  border-radius: 0;
  background: rgba(255, 0, 0, 0.12);
  color: var(--primary, #ff0000);
  font-size: 0.72rem;
}

.tickets-empty {
  padding: 2.5rem 1rem;
  color: var(--dash-muted, #888888);
  font-size: 0.75rem;
  text-align: center;
}

.tickets-mine-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.tickets-mine-card {
  border: 1px solid var(--dash-border, #1a1a1a);
  border-radius: 0;
  background: var(--dash-card, #101010);
}

.tickets-mine-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.tickets-mine-ref {
  color: var(--dash-text, #eeeeee);
  font-size: 0.8rem;
  font-weight: 600;
}

.tickets-status,
.tickets-mine-type {
  border-radius: 0 !important;
  font-family: 'Courier New', monospace !important;
  font-size: 0.64rem !important;
}

.tickets-status--pending {
  background: var(--dash-warning, #ffaa00) !important;
  color: var(--dash-bg, #000000) !important;
}

.tickets-status--progress {
  background: transparent !important;
  border: 1px solid var(--dash-warning, #ffaa00) !important;
  color: var(--dash-warning, #ffaa00) !important;
}

.tickets-status--resolved {
  background: var(--dash-success, #00ff00) !important;
  color: var(--dash-bg, #000000) !important;
}

.tickets-mine-type {
  background: transparent !important;
  border: 1px solid var(--dash-border, #1a1a1a) !important;
  color: var(--dash-muted, #888888) !important;
}

.tickets-mine-category,
.tickets-mine-target {
  color: var(--dash-muted, #888888);
  font-size: 0.68rem;
}

.tickets-mine-date {
  margin-left: auto;
  color: var(--dash-muted, #888888);
  font-size: 0.66rem;
}

.tickets-mine-body {
  padding-top: 0.85rem;
}

.tickets-mine-description {
  margin: 0;
  color: var(--dash-text, #eeeeee);
  font-size: 0.75rem;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.tickets-mine-resolution {
  margin-top: 0.85rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--dash-border, #1a1a1a);
  border-radius: 0;
  background: var(--dash-bg, #000000);
}

.tickets-mine-resolution span {
  color: var(--dash-muted, #888888);
  font-size: 0.66rem;
  text-transform: lowercase;
}

.tickets-mine-resolution p {
  margin: 0.3rem 0 0;
  color: var(--dash-text, #eeeeee);
  font-size: 0.75rem;
  line-height: 1.6;
}

.tickets-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.25rem;
  color: var(--dash-muted, #888888);
  font-size: 0.7rem;
}

.tickets-secondary-btn {
  border: 1px solid var(--dash-border, #1a1a1a) !important;
  border-radius: 0 !important;
  background: var(--dash-card, #101010) !important;
  color: var(--dash-text, #eeeeee) !important;
  font-family: 'Courier New', monospace;
  font-size: 0.7rem;
  text-transform: lowercase;
}

.tickets-secondary-btn:hover {
  border-color: var(--primary, #ff0000) !important;
  color: var(--primary, #ff0000) !important;
}
</style>

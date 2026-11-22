<template>
  <q-page class="calls-page q-pa-md">
    <div class="row items-center justify-between q-mb-lg">
      <h1 class="text-h6 text-weight-bold q-ma-none">Calls</h1>
      <div class="row q-gutter-xs">
        <q-btn
          flat
          icon="refresh"
          aria-label="Refresh call log"
          :loading="calls.loading"
          @click="calls.loadHistory(true)"
        />
        <q-btn
          flat
          icon="delete_outline"
          label="Clear log"
          :disable="!calls.history.length || calls.loading || clearing"
          @click="confirmClear"
        />
      </div>
    </div>
    <p v-if="!calls.supported" role="status">
      Voice calls are unavailable on this device. Windows and Android are supported first.
    </p>
    <p v-else-if="!calls.enabled" role="status">Voice calls are currently unavailable.</p>
    <div v-if="calls.error" role="alert">
      {{ calls.error }}
      <q-btn flat dense icon="refresh" aria-label="Retry loading call history" :loading="calls.loading" @click="calls.loadHistory(true)" />
    </div>
    <CallSettings />
    <q-separator class="q-my-md" />
    <p v-if="!calls.loading && !calls.error && !calls.history.length">
      No recent calls. Start a call from a conversation.
    </p>
    <q-list separator>
      <q-item v-for="call in calls.history" :key="call.id" :clickable="callable(call.linkId)" @click="openChat(call.linkId)">
        <q-item-section avatar
          ><q-icon :name="call.callerId === auth.user?.id ? 'call_made' : 'call_received'"
        /></q-item-section>
        <q-item-section>
          <q-item-label>{{ label(call) }}</q-item-label>
          <q-item-label caption
            >{{ historyStatus(call, call.callerId !== auth.user?.id) }} · {{ new Date(call.createdAt).toLocaleString()
            }}<template v-if="call.answeredAt && call.endedAt">
              · {{ callDuration(call) }}</template
            ></q-item-label
          >
        </q-item-section>
        <q-item-section side
          ><q-btn flat round icon="more_vert" aria-label="Call options" @click.stop>
            <q-menu>
              <q-list>
                <q-item v-close-popup clickable :disable="!calls.canCall || !callable(call.linkId)" @click.stop="calls.dial(call.linkId)"><q-item-section>Call again</q-item-section></q-item>
                <q-item v-close-popup clickable :disable="clearing" @click.stop="remove(call.id)"><q-item-section>Delete from log</q-item-section></q-item>
              </q-list>
            </q-menu>
          </q-btn>
        ></q-item-section>
      </q-item>
    </q-list>
    <div class="row justify-center q-mt-md">
      <q-btn
        v-if="calls.hasMore"
        outline
        label="Load older calls"
        :loading="calls.loading"
        @click="calls.loadHistory()"
      /><q-spinner v-else-if="calls.loading" />
    </div>
  </q-page>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import { useVaultStore } from 'src/stores/vault';
import { useCallsStore } from 'src/stores/calls';
import { useAuthStore } from 'src/stores/auth';
import { useLinksStore } from 'src/stores/links';
import type { ServerCall } from 'src/calls/types';
import { callDuration, historyStatus } from 'src/components/calls/presentation';
import CallSettings from 'src/components/calls/CallSettings.vue';
const calls = useCallsStore();
const auth = useAuthStore();
const links = useLinksStore();
const q = useQuasar();
const clearing = ref(false);
const router = useRouter();
const vault = useVaultStore();
async function openChat(id: string) {
  if (!callable(id)) return;
  const account = auth.user?.id;
  await router.push('/chains');
  if (account && auth.user?.id === account && callable(id)) vault.setActiveLink(id);
}
async function remove(id?: string) {
  if (clearing.value) return;
  clearing.value = true;
  try { await calls.clearHistory(id); } finally { clearing.value = false; }
}
function callable(id: string) {
  return links.activeChains.some((link) => link.id === id);
}
function label(call: ServerCall) {
  const link = links.links.find((row) => row.id === call.linkId);
  if (!link) return 'Former contact';
  const peer = link.senderId === auth.user?.id ? link.receiver : link.sender;
  return peer.profile?.displayName || peer.username;
}
function confirmClear() {
  q.dialog({
    title: 'Clear call log?',
    message:
      'Remove call history from your account on all devices. This does not clear your contact’s log.',
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void remove();
  });
}
watch(
  () => calls.ready,
  (ready) => {
    if (ready) void calls.loadHistory(true);
  },
  { immediate: true },
);
</script>
<style scoped>
.calls-page {
  max-width: 840px;
  margin: auto;
  color: rgb(var(--m-text-rgb));
  font-family: monospace;
}
.calls-page :deep(.q-item__label--caption) {
  color: rgb(var(--m-textMuted-rgb));
}
</style>

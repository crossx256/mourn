<template>
  <div>
    <div class="flex justify-between items-start mb-6 gap-4">
      <div>
        <div class="dash-back-inline">
          <q-btn
            v-if="$q?.screen?.lt?.md"
            round
            flat
            icon="mdi-arrow-left"
            to="/"
            color="primary"
            size="md"
            dense
            class="dash-back-btn"
            aria-label="back to home"
          />
          <h1 class="text-xl text-primary m-0 tracking-wide lowercase font-bold leading-none">
            privacy
          </h1>
        </div>
        <p class="text-muted text-xs m-0">control how your data is handled</p>
      </div>
    </div>

    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title privacy-section-title">file uploads</div>
        <p class="text-muted text-xs mb-4">
          Control how file names are handled when you upload files to chats.
        </p>

        <label class="toggle-item compact mb-4 privacy-toggle-row">
          <input v-model="randomizeFileNames" type="checkbox" />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">randomize file names</span>
            <span class="toggle-desc">
              uploaded files are sent under a random identifier instead of their name
            </span>
          </div>
        </label>

        <div class="grid gap-3 text-xs text-muted">
          <div class="rounded border border-solid border-dash-border bg-dash-bg px-4 py-3">
            <span class="text-primary font-bold">enabled:</span> the file name the other side
            sees is replaced with a random identifier; the extension is kept so the file still
            opens. File contents are unchanged — this hides the name, not what the file holds, and
            it cannot reach a name already written into the file itself.
          </div>
          <div class="rounded border border-solid border-dash-border bg-dash-bg px-4 py-3">
            <span class="text-primary font-bold">scope:</span> kept on this device only and applied
            to your future uploads. Messages already sent keep the name they were sent with.
          </div>
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title privacy-section-title">notifications</div>
        <p class="text-muted text-xs mb-4">
          Control what a push notification reveals before you open the app.
        </p>

        <label class="toggle-item compact mb-4 privacy-toggle-row">
          <input v-model="anonymousNotifications" type="checkbox" />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">anonymous notifications</span>
            <span class="toggle-desc">
              cluster messages into one generic notification with no sender name or message content
            </span>
          </div>
        </label>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title privacy-section-title">messaging</div>
        <p class="text-muted text-xs mb-4">
          End-to-end encrypted chat security built into the vault.
        </p>

        <div class="grid gap-3 text-xs text-muted">
          <div
            v-for="feature in messagingSecurityFeatures"
            :key="feature.title"
            class="rounded border border-solid border-dash-border bg-dash-bg px-4 py-3"
          >
            <span class="text-primary font-bold">{{ feature.title }}:</span>
            {{ feature.description }}
          </div>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useDashboardStore } from 'src/stores/dashboard';

const $q = useQuasar();
const dashboardStore = useDashboardStore();

const messagingSecurityFeatures = [
  {
    title: 'end-to-end encryption',
    description:
      'messages use double ratchet encryption per device. the server only relays ciphertext.',
  },
  {
    title: 'no server storage',
    description:
      'message plaintext is not stored on the routing node — only on your device after decryption.',
  },
  {
    title: 'suspicious activity detection',
    description:
      'session fingerprint mismatches are logged, sessions are invalidated, and watcher alerts can email you.',
  },
  {
    title: 'compromised link quarantine',
    description:
      'if a contact’s device identity changes unexpectedly, the link is quarantined and new messages are blocked until you review.',
  },
  {
    title: 'identity verification',
    description:
      'verify a contact’s device fingerprint out-of-band in chat settings before trusting sensitive threads.',
  },
  {
    title: 'message quarantine',
    description:
      'messages from a changed identity are held locally until you allow, reject, or trust the new identity.',
  },
  {
    title: 'temporary safety window',
    description: 'optionally allow messaging for five minutes while you verify an identity change.',
  },
  {
    title: 'encrypted file blobs',
    description:
      'attachments are encrypted client-side before upload; the server stores only opaque bytes with a short ttl.',
  },
  {
    title: 'device login alerts',
    description:
      'when your account signs in elsewhere, other active devices are notified so you can log out or mark the session safe.',
  },
  {
    title: 'delete for everyone',
    description:
      'tombstone notices remove messages from all participants’ local vaults when supported.',
  },
  {
    title: 'rate limiting',
    description: 'vault websocket and api routes are rate-limited to reduce abuse and flooding.',
  },
];

onMounted(() => {
  // The store owns persistence; hydrating here keeps a tab opened before the
  // messaging page mounted consistent with the device preference.
  dashboardStore.hydrateRandomizeFileNames();
  // Pull the persisted notification preference from the server, like the
  // watcher settings surface does, so the toggle reflects the account state.
  void dashboardStore.fetchNotificationPreferences();
});

const randomizeFileNames = computed({
  get: () => dashboardStore.randomizeFileNames,
  set: (value: boolean) => dashboardStore.setRandomizeFileNames(value),
});

const anonymousNotifications = computed({
  get: () => dashboardStore.anonymousNotifications,
  set: (value: boolean) => {
    void persistAnonymousNotifications(value);
  },
});

async function persistAnonymousNotifications(value: boolean): Promise<void> {
  const ok = await dashboardStore.setAnonymousNotifications(value);
  if (!ok) {
    $q.notify({
      type: 'negative',
      message: 'failed to update notification preference',
      position: 'bottom-right',
    });
  }
}
</script>

<style scoped>
.dash-back-inline {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.privacy-section-title {
  color: var(--primary);
}

.privacy-toggle-row {
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.privacy-toggle-row .toggle-info {
  min-width: 0;
  order: 1;
}

.privacy-toggle-row .toggle-label {
  color: var(--primary);
  font-weight: 700;
}

.privacy-toggle-row .toggle-desc {
  line-height: 1.45;
}

.privacy-toggle-row input {
  order: 2;
}

.privacy-toggle-row .toggle-switch {
  order: 3;
}
</style>

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
            security
          </h1>
        </div>
        <p class="text-muted text-xs m-0">review registered devices and account sessions</p>
      </div>
    </div>

    <q-card v-if="loading" flat bordered dark class="dash-card security-state-card">
      <q-card-section class="flex items-center justify-center gap-3 text-muted text-sm">
        <q-spinner color="primary" size="22px" />
        <span>loading security activity</span>
      </q-card-section>
    </q-card>

    <q-card
      v-else-if="errorMessage && !hasData"
      flat
      bordered
      dark
      class="dash-card security-state-card"
    >
      <q-card-section class="text-center">
        <q-icon name="fas fa-triangle-exclamation" color="negative" size="20px" />
        <p class="text-negative text-sm my-3">{{ errorMessage }}</p>
        <div class="flex items-center justify-center gap-2">
          <q-btn
            outline
            no-caps
            color="primary"
            icon="mdi-refresh"
            label="retry"
            :loading="loading"
            @click="refreshSecurityData"
          />
          <q-btn v-if="errorNeedsSignIn" flat no-caps color="primary" label="sign in" to="/login" />
        </div>
      </q-card-section>
    </q-card>

    <template v-else>
      <!-- A failed refresh keeps the last good rows and says so, instead of
           collapsing the panel back to a spinner or a blank state card. -->
      <div v-if="errorMessage" class="security-refresh-error">
        <q-icon name="fas fa-triangle-exclamation" color="negative" size="14px" />
        <span class="text-negative">{{ errorMessage }}</span>
        <q-btn
          flat
          dense
          no-caps
          size="sm"
          color="primary"
          label="retry"
          class="q-ml-auto"
          :loading="refreshing"
          @click="refreshSecurityData"
        />
      </div>

      <q-card flat bordered dark class="dash-card mb-5" data-field="security-devices">
        <q-card-section>
          <div class="dash-section-title">
            registered devices
            <span class="sec-count">{{ devices.length }}</span>
            <q-btn
              flat
              dense
              round
              size="xs"
              icon="mdi-refresh"
              class="sec-refresh"
              aria-label="refresh registered devices"
              :loading="refreshing"
              @click="refreshSecurityData"
            />
          </div>
          <p class="text-muted text-xs mb-3">
            devices associated with your encrypted messaging identity.
          </p>

          <div v-if="devices.length === 0" class="security-empty">No devices registered yet</div>

          <div v-else class="sec-rows">
            <div v-for="device in devices" :key="device.id" class="sec-row">
              <div
                class="sec-main"
                role="button"
                tabindex="0"
                :aria-label="`details for ${device.deviceName || 'unnamed device'}`"
                @click="openDeviceDetails(device)"
                @keydown.enter.prevent="openDeviceDetails(device)"
                @keydown.space.prevent="openDeviceDetails(device)"
              >
                <span v-if="device.suspicious" class="suspicion-dot" aria-hidden="true" />
                <span class="sec-name">{{ device.deviceName || 'unnamed device' }}</span>
                <span class="sec-tags">
                  <q-badge v-if="device.isCurrent" square color="primary" text-color="white">
                    current
                  </q-badge>
                  <q-badge
                    square
                    :color="device.isTrusted ? 'positive' : 'grey-8'"
                    text-color="white"
                  >
                    {{ device.isTrusted ? 'trusted' : 'not trusted' }}
                  </q-badge>
                  <q-badge v-if="device.suspicious" square color="negative" text-color="white">
                    suspicious
                  </q-badge>
                </span>
                <span class="sec-when">seen {{ formatShort(device.lastSeenAt) }}</span>
                <q-icon name="mdi-chevron-right" class="sec-chev" size="14px" />
              </div>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered dark class="dash-card mb-5" data-field="security-sessions">
        <q-card-section>
          <div class="dash-section-title">
            sessions
            <span class="sec-count">{{ liveSessions.length }} active</span>
          </div>
          <p class="text-muted text-xs mb-3">
            active sessions only — these are the sessions that can act on your account right now.
            you can revoke any of them except this one.
            <template v-if="sessionCounts.hidden > 0">
              {{ sessionCounts.hidden }} expired or revoked
              {{ sessionCounts.hidden === 1 ? 'session is' : 'sessions are' }} not shown.
            </template>
          </p>

          <div v-if="liveSessions.length > 0" class="sec-rows">
            <div
              v-for="session in liveSessions"
              :key="session.id"
              class="sec-row"
              :class="{ 'sec-row--current': session.isCurrent }"
            >
              <div
                class="sec-main"
                role="button"
                tabindex="0"
                :aria-label="`details for ${session.deviceName || 'unnamed session'}`"
                @click="openSessionDetails(session)"
                @keydown.enter.prevent="openSessionDetails(session)"
                @keydown.space.prevent="openSessionDetails(session)"
              >
                <span v-if="session.suspicious" class="suspicion-dot" aria-hidden="true" />
                <span class="sec-name">{{ session.deviceName || 'unnamed session' }}</span>
                <span class="sec-tags">
                  <q-badge v-if="session.isCurrent" square color="primary" text-color="white">
                    current
                  </q-badge>
                  <q-badge square color="positive" text-color="white"> active </q-badge>
                  <q-badge
                    v-if="session.isRegisteredDevice"
                    square
                    :color="session.isTrusted ? 'positive' : 'grey-8'"
                    text-color="white"
                  >
                    {{ session.isTrusted ? 'trusted' : 'not trusted' }}
                  </q-badge>
                  <q-badge v-else square color="grey-8" text-color="white">
                    unregistered device
                  </q-badge>
                  <q-badge v-if="session.suspicious" square color="negative" text-color="white">
                    suspicious
                  </q-badge>
                </span>
                <span class="sec-when">
                  {{ `active ${formatShort(session.lastActivityAt)}` }}
                </span>
                <q-btn
                  v-if="!session.isCurrent"
                  flat
                  dense
                  no-caps
                  size="sm"
                  color="negative"
                  icon="mdi-logout"
                  label="revoke"
                  :loading="loggingOutSessionId === session.id"
                  :disable="loggingOutSessionId !== null"
                  @click.stop="logoutSession(session.id)"
                />
                <q-icon v-else name="mdi-chevron-right" class="sec-chev" size="14px" />
              </div>
            </div>
          </div>

          <div v-if="otherSessions.length === 0" class="security-empty mt-3">No other sessions</div>
        </q-card-section>
      </q-card>
    </template>

    <!-- Details live behind an on-demand popup so the rows stay readable. -->
    <q-dialog v-model="detailsOpen" transition-show="fade" transition-hide="fade">
      <q-card class="sec-dialog bg-[#0f0f12] text-white border border-[#2a2a30]">
        <q-card-section class="pb-2">
          <div class="text-[10px] uppercase tracking-[0.35em] text-primary/70 mb-2">
            {{ detailsKind }}
          </div>
          <div class="text-base font-semibold leading-tight">{{ detailsTitle }}</div>
          <div class="sec-tags mt-2">
            <q-badge
              v-for="badge in detailsBadges"
              :key="badge.label"
              square
              :color="badge.color"
              text-color="white"
            >
              {{ badge.label }}
            </q-badge>
          </div>
        </q-card-section>

        <q-separator dark />

        <q-card-section class="sec-dialog-fields">
          <div
            v-for="field in detailsFields"
            :key="field.label"
            :class="{ 'sec-field--wide': field.wide }"
          >
            <div class="sec-field-label">{{ field.label }}</div>
            <div class="sec-field-value">{{ field.value }}</div>
          </div>
        </q-card-section>

        <div v-if="detailsReasons.length > 0" class="suspicion-reasons mx-4 mb-3">
          <div class="suspicion-reasons-title">reported reasons</div>
          <ul>
            <li v-for="reason in detailsReasons" :key="reason">{{ reason }}</li>
          </ul>
        </div>

        <q-card-actions align="right" class="px-4 pb-3 pt-0 gap-2">
          <q-btn
            v-if="detailsSessionId"
            flat
            no-caps
            color="negative"
            icon="mdi-logout"
            label="revoke session"
            :loading="loggingOutSessionId === detailsSessionId"
            @click="revokeFromDialog"
          />
          <q-btn flat no-caps label="close" class="text-white/70" @click="detailsOpen = false" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useAuthStore } from 'src/stores/auth';
import {
  describeSecurityLoadError,
  invalidateSecuritySnapshot,
  loadSecuritySnapshot,
  peekSecuritySnapshot,
  type SecurityDevice,
  type SecuritySession,
  type SecuritySnapshot,
  type SessionCounts,
} from 'src/services/securityDevices';

interface LogoutResponse {
  success: boolean;
  error?: string;
}

interface DetailField {
  label: string;
  value: string;
  wide?: boolean;
}

interface DetailBadge {
  label: string;
  color: string;
}

const $q = useQuasar();
const authStore = useAuthStore();
const devices = ref<SecurityDevice[]>([]);
const sessions = ref<SecuritySession[]>([]);
const sessionCounts = ref<SessionCounts>({ total: 0, active: 0, showing: 0, hidden: 0 });
const loading = ref(true);
const errorMessage = ref('');
const errorNeedsSignIn = ref(false);
const loggingOutSessionId = ref<string | null>(null);
/** True while a background refresh runs over already-rendered rows. */
const refreshing = ref(false);
/** Bumped per load so a late response can never own the current panel state. */
let loadGeneration = 0;

/**
 * The security tab is an action surface, so it renders ONLY live sessions: the
 * API already filters to `isActive && expiresAt > now`, and this second filter
 * guarantees a lapsed row can never render as an "active" card even if the
 * caller's own session had to be force-included by the backend.
 */
const liveSessions = computed(() => sessions.value.filter((session) => session.isActive));
const otherSessions = computed(() => liveSessions.value.filter((session) => !session.isCurrent));
/** True once there is anything worth rendering instead of a full-card state. */
const hasData = computed(() => devices.value.length > 0 || liveSessions.value.length > 0);

function applySnapshot(snapshot: SecuritySnapshot): void {
  devices.value = snapshot.devices;
  sessions.value = snapshot.sessions;
  sessionCounts.value = snapshot.sessionCounts;
}

// --- Details popup (on demand) ---
const detailsOpen = ref(false);
const detailsKind = ref<'device' | 'session'>('device');
const detailsTitle = ref('');
const detailsBadges = ref<DetailBadge[]>([]);
const detailsFields = ref<DetailField[]>([]);
const detailsReasons = ref<string[]>([]);
const detailsSessionId = ref<string | null>(null);

function deviceDetails(device: SecurityDevice): {
  badges: DetailBadge[];
  fields: DetailField[];
} {
  const badges: DetailBadge[] = [];
  if (device.isCurrent) badges.push({ label: 'current device', color: 'primary' });
  badges.push({
    label: device.isTrusted ? 'trusted' : 'not trusted',
    color: device.isTrusted ? 'positive' : 'grey-8',
  });
  if (device.suspicious) badges.push({ label: 'suspicious', color: 'negative' });

  const fields: DetailField[] = [
    { label: 'registered', value: formatDate(device.createdAt) },
    { label: 'last seen', value: formatDate(device.lastSeenAt) },
    { label: 'device hash', value: device.deviceHashPreview || 'unknown', wide: true },
    { label: 'public key', value: device.publicKeyPreview || 'unknown', wide: true },
  ];
  if (device.riskFingerprintPreview) {
    fields.push({ label: 'risk fingerprint', value: device.riskFingerprintPreview, wide: true });
  }
  if (device.suspicious && device.suspicionScore !== null) {
    fields.push({ label: 'suspicion score', value: String(device.suspicionScore) });
  }
  return { badges, fields };
}

function sessionDetails(session: SecuritySession): {
  badges: DetailBadge[];
  fields: DetailField[];
} {
  const badges: DetailBadge[] = [];
  if (session.isCurrent) badges.push({ label: 'current session', color: 'primary' });
  badges.push({ label: 'active', color: 'positive' });
  if (session.isRegisteredDevice) {
    badges.push({
      label: session.isTrusted ? 'trusted' : 'not trusted',
      color: session.isTrusted ? 'positive' : 'grey-8',
    });
  } else {
    badges.push({ label: 'unregistered device', color: 'grey-8' });
  }
  if (session.suspicious) badges.push({ label: 'suspicious', color: 'negative' });

  const fields: DetailField[] = [
    { label: 'created', value: formatDate(session.createdAt) },
    { label: 'last activity', value: formatDate(session.lastActivityAt) },
    { label: session.isActive ? 'expires' : 'ended', value: formatDate(session.expiresAt) },
    { label: 'credential version', value: String(session.credentialVersion) },
    { label: 'device hash', value: session.deviceHashPreview || 'none', wide: true },
  ];
  if (session.ipSubnetHashPreview) {
    fields.push({ label: 'network hash', value: session.ipSubnetHashPreview, wide: true });
  }
  if (session.userAgent) {
    fields.push({ label: 'user agent', value: session.userAgent, wide: true });
  }
  if (session.riskFingerprintPreview) {
    fields.push({ label: 'risk fingerprint', value: session.riskFingerprintPreview, wide: true });
  }
  if (session.suspicious && session.suspicionScore !== null) {
    fields.push({ label: 'suspicion score', value: String(session.suspicionScore) });
  }
  return { badges, fields };
}

function openDeviceDetails(device: SecurityDevice): void {
  const { badges, fields } = deviceDetails(device);
  detailsKind.value = 'device';
  detailsTitle.value = device.deviceName || 'unnamed device';
  detailsBadges.value = badges;
  detailsFields.value = fields;
  detailsReasons.value = device.suspicious ? device.suspicionReasons : [];
  detailsSessionId.value = null;
  detailsOpen.value = true;
}

function openSessionDetails(session: SecuritySession): void {
  const { badges, fields } = sessionDetails(session);
  detailsKind.value = 'session';
  detailsTitle.value = session.deviceName || 'unnamed session';
  detailsBadges.value = badges;
  detailsFields.value = fields;
  detailsReasons.value = session.suspicious ? session.suspicionReasons : [];
  detailsSessionId.value = session.isCurrent || !session.isActive ? null : session.id;
  detailsOpen.value = true;
}

async function revokeFromDialog(): Promise<void> {
  const id = detailsSessionId.value;
  if (!id) return;
  detailsOpen.value = false;
  await logoutSession(id);
}

function formatDate(value: string | null): string {
  if (!value) return 'never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Short "today 22:14" / "yesterday 09:02" / "Sep 3 18:40" stamp for list rows. */
function formatShort(value: string | null): string {
  if (!value) return 'never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';

  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) return `today ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;

  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return `${date.toLocaleDateString(undefined, options)} ${time}`;
}

async function fetchSecurityData(force = false): Promise<void> {
  // Every load owns a generation. A response that belongs to an older load can
  // never flip `loading`, blank the rows or overwrite a newer snapshot, which
  // is what made overlapping mounts flash the panel back to a spinner.
  const generation = ++loadGeneration;

  // Only a cold panel shows the full-card spinner. A refresh keeps the existing
  // rows on screen so the panel never "resets" while it reloads.
  loading.value = devices.value.length === 0 && sessions.value.length === 0;
  refreshing.value = !loading.value;
  errorMessage.value = '';
  errorNeedsSignIn.value = false;

  try {
    const snapshot = await loadSecuritySnapshot({
      uid: authStore.user?.id ?? '',
      force,
    });

    if (generation !== loadGeneration) return;
    applySnapshot(snapshot);
  } catch (error) {
    if (generation !== loadGeneration) return;

    const described = describeSecurityLoadError(error);
    errorMessage.value = described.message;
    errorNeedsSignIn.value = described.needsSignIn;

    // Keep rows we already have; only clear when there is nothing worth showing.
    if (devices.value.length === 0) {
      sessions.value = [];
      sessionCounts.value = { total: 0, active: 0, showing: 0, hidden: 0 };
    }
  } finally {
    // The loader is deadline-bound, so this always runs — the spinner can no
    // longer survive a hung csrf/secure-storage read.
    if (generation === loadGeneration) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}

function refreshSecurityData(): void {
  void fetchSecurityData(true);
}

async function logoutSession(id: string): Promise<void> {
  const session = sessions.value.find((item) => item.id === id);
  if (!session || !session.isActive || session.isCurrent || loggingOutSessionId.value !== null) {
    return;
  }

  loggingOutSessionId.value = id;

  try {
    const response = await authStore.postWithFreshCsrf<LogoutResponse>(
      `/api/v1/security/sessions/${encodeURIComponent(id)}/logout`,
      {},
    );

    if (!response.data?.success) {
      throw new Error(response.data?.error || 'session logout failed');
    }

    sessions.value = sessions.value.filter((item) => item.id !== id);
    sessionCounts.value = {
      ...sessionCounts.value,
      active: Math.max(0, sessionCounts.value.active - 1),
      showing: Math.max(0, sessionCounts.value.showing - 1),
    };
    // The device/session set just changed — the shared snapshot is stale now.
    invalidateSecuritySnapshot();
    $q.notify({
      type: 'positive',
      message: 'session logged out',
      position: 'bottom-right',
    });
  } catch {
    $q.notify({
      type: 'negative',
      message: 'failed to log out session',
      position: 'bottom-right',
    });
  } finally {
    loggingOutSessionId.value = null;
  }
}

onMounted(() => {
  // Paint from the shared snapshot first (no I/O). While the cache is warm the
  // call below is a cache hit, so re-mounting this tab — which the dashboard's
  // tab transition does on every tab switch — cannot re-hit the API.
  const cached = peekSecuritySnapshot(authStore.user?.id ?? '');
  if (cached) applySnapshot(cached);

  void fetchSecurityData();
});

onBeforeUnmount(() => {
  // A response still in flight must never touch this instance's refs.
  loadGeneration += 1;
});
</script>

<style scoped>
.dash-back-inline {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.security-state-card {
  min-height: 9rem;
  display: grid;
  place-items: center;
}

.sec-count {
  margin-left: 0.45rem;
  color: var(--dash-muted);
  font-size: 0.62rem;
  font-weight: 400;
  letter-spacing: 0.08em;
}

.sec-refresh {
  margin-left: auto;
  color: var(--dash-muted);
}

.sec-refresh:hover {
  color: var(--primary);
}

/* Stale-data banner: shown when a refresh failed but rows are still on screen. */
.security-refresh-error {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.75rem;
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--dash-error);
  background: var(--dash-bg);
  font-size: 0.65rem;
  line-height: 1.35;
}

/* Compact list: one line per device/session, details in the popup. */
.sec-rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dash-border);
}

.sec-row {
  border-bottom: 1px solid var(--dash-border);
}

.sec-row:last-child {
  border-bottom: 0;
}

.sec-row--current {
  background: var(--dash-bg);
}

.sec-main {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.4rem 0.55rem;
  cursor: pointer;
}

.sec-main:hover {
  background: rgba(255, 255, 255, 0.025);
}

.sec-main:focus-visible {
  outline: 1px solid var(--primary);
  outline-offset: -1px;
}

.sec-name {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--dash-text);
  font-size: 0.78rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sec-tags {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.3rem;
}

.sec-tags :deep(.q-badge) {
  padding: 1px 5px;
  font-size: 0.58rem;
  line-height: 1.35;
}

.sec-when {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--dash-muted);
  font-size: 0.65rem;
  white-space: nowrap;
}

.sec-chev {
  flex: 0 0 auto;
  color: var(--dash-muted);
}

.suspicion-dot {
  width: 0.4rem;
  height: 0.4rem;
  flex: 0 0 auto;
  background: var(--dash-error);
  border-radius: 0;
}

/* --- Details popup --- */
.sec-dialog {
  width: 460px;
  max-width: 92vw;
  border-radius: 0;
}

.sec-dialog-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.7rem 1rem;
}

.sec-field-label {
  margin-bottom: 0.15rem;
  color: var(--dash-muted);
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  text-transform: lowercase;
}

.sec-field-value {
  color: var(--dash-text);
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}

.sec-field--wide {
  grid-column: 1 / -1;
}

.suspicion-reasons {
  padding: 0.7rem;
  color: var(--dash-text);
  background: var(--dash-bg);
  border: 1px solid var(--dash-error);
  border-radius: 0;
  font-size: 0.72rem;
}

.suspicion-reasons-title {
  margin-bottom: 0.35rem;
  color: var(--dash-error);
  font-weight: 700;
}

.suspicion-reasons ul {
  margin: 0;
  padding-left: 1.2rem;
}

.security-empty {
  padding: 0.9rem;
  color: var(--dash-muted);
  background: var(--dash-bg);
  border: 1px solid var(--dash-border);
  border-radius: 0;
  font-size: 0.78rem;
  text-align: center;
}

@media (max-width: 599px) {
  .sec-main {
    flex-wrap: wrap;
    row-gap: 0.3rem;
  }

  .sec-name {
    flex: 1 1 100%;
  }

  .sec-tags {
    flex-wrap: wrap;
  }

  .sec-when {
    margin-left: 0;
  }

  .sec-dialog-fields {
    grid-template-columns: minmax(0, 1fr);
  }

  .sec-field--wide {
    grid-column: auto;
  }
}
</style>

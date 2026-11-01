<template>
  <div>
    <!-- Tab Header -->
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
            watcher
          </h1>
        </div>
        <p class="text-muted text-xs m-0">privacy-centric security monitoring</p>
      </div>
    </div>

    <!-- Level Selector -->
    <q-card flat bordered dark class="dash-card mb-5" data-field="watcher-level">
      <q-card-section>
        <div class="dash-section-title">protection level</div>
        <p class="text-muted text-xs mb-4">
          choose how your security events are recorded. this never affects admin logs.
        </p>

        <div class="space-y-3">
          <!-- Level 1 -->
          <div
            class="watcher-level-option"
            role="button"
            tabindex="0"
            :aria-pressed="watcherStore.watcherLevel === 1"
            @keydown.enter.prevent="setLevel(1)"
            @keydown.space.prevent="setLevel(1)"
            :class="{ 'watcher-level-active': watcherStore.watcherLevel === 1 }"
            @click="setLevel(1)"
          >
            <div class="flex items-center gap-3">
              <div class="watcher-radio" :class="{ active: watcherStore.watcherLevel === 1 }">
                <div v-if="watcherStore.watcherLevel === 1" class="watcher-radio-inner" />
              </div>
              <div>
                <div class="text-sm font-semibold text-white lowercase tracking-wide">
                  standard privacy
                </div>
                <div class="text-xs text-muted">no history stored. clean slate.</div>
              </div>
            </div>
          </div>

          <!-- Level 2 -->
          <div
            class="watcher-level-option"
            role="button"
            tabindex="0"
            :aria-pressed="watcherStore.watcherLevel === 2"
            @keydown.enter.prevent="setLevel(2)"
            @keydown.space.prevent="setLevel(2)"
            :class="{ 'watcher-level-active': watcherStore.watcherLevel === 2 }"
            @click="setLevel(2)"
          >
            <div class="flex items-center gap-3">
              <div class="watcher-radio" :class="{ active: watcherStore.watcherLevel === 2 }">
                <div v-if="watcherStore.watcherLevel === 2" class="watcher-radio-inner" />
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold text-white lowercase tracking-wide">
                  watcher mode
                  <span class="text-[10px] text-muted ml-1">(desktop only)</span>
                </div>
                <div class="text-xs text-muted">
                  logs stored on your device. mourn.bio stays blind to your IP.
                </div>
                <div
                  v-if="!isTauri && watcherStore.watcherLevel === 2"
                  class="mt-2 text-xs text-primary font-mono"
                >
                  ⚠ this mode is active but only works in the desktop app. logs will sync when you
                  next open mourn desktop.
                </div>
              </div>
            </div>
          </div>

          <!-- Level 3 -->
          <div
            class="watcher-level-option"
            role="button"
            tabindex="0"
            :aria-pressed="watcherStore.watcherLevel === 3"
            @keydown.enter.prevent="setLevel(3)"
            @keydown.space.prevent="setLevel(3)"
            :class="{ 'watcher-level-active': watcherStore.watcherLevel === 3 }"
            @click="setLevel(3)"
          >
            <div class="flex items-center gap-3">
              <div class="watcher-radio" :class="{ active: watcherStore.watcherLevel === 3 }">
                <div v-if="watcherStore.watcherLevel === 3" class="watcher-radio-inner" />
              </div>
              <div>
                <div class="text-sm font-semibold text-white lowercase tracking-wide">
                  cloud backup
                </div>
                <div class="text-xs text-muted">
                  recent 50 logs stored on our server for multi-device sync.
                </div>
              </div>
            </div>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Alert Email -->
    <q-card flat bordered dark class="dash-card mb-5" data-field="watcher-alert-email">
      <q-card-section>
        <div class="dash-section-title">security alert email</div>
        <p class="text-muted text-xs mb-4">
          receive an email whenever suspicious activity is detected on your account.
          <br />
          <span class="text-hellamuted">
            defaults to your account email if left blank. changes require your current password and
            a 6-digit verification code.
          </span>
        </p>

        <div class="flex gap-3 items-end flex-wrap">
          <q-input
            v-model="alertEmailInput"
            dense
            outlined
            dark
            :placeholder="watcherStore.accountEmail || 'email@example.com'"
            input-class="text-white font-mono text-sm"
            class="flex-1 dashboard-no-label-field"
            style="max-width: 360px"
          />
          <q-input
            v-if="!isVerifying && !watcherStore.pendingAlertEmail"
            v-model="currentPassword"
            dense
            outlined
            dark
            type="password"
            autocomplete="current-password"
            placeholder="current password"
            input-class="text-white font-mono text-sm"
            class="dashboard-no-label-field"
            style="max-width: 220px"
          />
          <q-input
            v-if="isVerifying || watcherStore.pendingAlertEmail"
            v-model="verificationCode"
            dense
            outlined
            dark
            maxlength="6"
            placeholder="6-digit code"
            input-class="text-white font-mono text-sm tracking-[0.35em] text-center"
            class="dashboard-no-label-field"
            style="max-width: 180px"
          />
          <q-btn
            v-if="!isVerifying"
            unelevated
            dense
            no-caps
            class="bg-primary text-white text-xs px-3"
            :label="
              watcherStore.alertEmail || watcherStore.pendingAlertEmail
                ? 'verify email'
                : 'verify email'
            "
            :loading="savingEmail"
            @click="startVerification"
          />
          <q-btn
            v-else
            unelevated
            dense
            no-caps
            class="bg-primary text-white text-xs px-3"
            label="confirm code"
            :loading="savingEmail"
            @click="confirmVerification"
          />
          <q-btn
            v-if="isVerifying || watcherStore.pendingAlertEmail"
            flat
            dense
            no-caps
            class="text-muted text-xs"
            label="cancel"
            @click="cancelVerification"
          />
          <q-btn
            v-if="watcherStore.alertEmail && !isVerifying"
            flat
            dense
            no-caps
            class="text-muted text-xs"
            label="change email"
            @click="beginChangeEmail"
          />
        </div>

        <div v-if="watcherStore.pendingAlertEmail" class="mt-3 text-xs text-primary font-mono">
          verification sent to {{ watcherStore.pendingAlertEmail }}
        </div>
      </q-card-section>
    </q-card>

    <!-- Max Local Entries (Level 2 only) -->
    <q-card
      v-if="watcherStore.watcherLevel === 2"
      flat
      bordered
      dark
      class="dash-card mb-5"
      data-field="watcher-max-entries"
    >
      <q-card-section>
        <div class="dash-section-title">local storage limit</div>
        <p class="text-muted text-xs mb-3">maximum number of log entries kept on your device.</p>
        <q-input
          v-model.number="watcherStore.maxLocalEntries"
          dense
          outlined
          dark
          type="number"
          input-class="text-white font-mono text-sm"
          style="max-width: 160px"
          :rules="[(v: number) => (v >= 10 && v <= 10000) || 'between 10 and 10,000']"
          class="dashboard-no-label-field"
        />
      </q-card-section>
    </q-card>

    <!-- Actions (Level 2 desktop) -->
    <div v-if="watcherStore.watcherLevel === 2 && isTauri" class="flex gap-3 mb-5">
      <q-btn
        flat
        no-caps
        dense
        icon="mdi-sync"
        label="claim now"
        class="text-primary text-xs"
        :loading="claiming"
        @click="claimNow"
      />
      <q-btn
        flat
        no-caps
        dense
        icon="mdi-delete-outline"
        label="clear local logs"
        class="text-muted text-xs"
        @click="confirmClearLogs"
      />
    </div>

    <!-- Log Viewer -->
    <WatcherLog />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useWatcherStore } from 'src/stores/watcher';
import { useNativeShell } from 'src/composables/useNativeShell';
import WatcherLog from './WatcherLog.vue';
import type { WatcherLevel } from 'src/stores/watcher';

const $q = useQuasar();
const watcherStore = useWatcherStore();
const { isTauri } = useNativeShell();

const alertEmailInput = ref('');
const verificationCode = ref('');
const currentPassword = ref('');
const isVerifying = ref(false);
const savingEmail = ref(false);
const claiming = ref(false);
let disposed = false;

onMounted(async () => {
  await watcherStore.fetchSettings();
  if (disposed) return;
  alertEmailInput.value =
    watcherStore.pendingAlertEmail || watcherStore.alertEmail || watcherStore.accountEmail || '';
  isVerifying.value = Boolean(watcherStore.pendingAlertEmail);
  // Auto-start sync worker for Level 2 in desktop
  if (watcherStore.watcherLevel === 2 && isTauri.value) {
    watcherStore.startSyncInterval();
  }
});

onUnmounted(() => {
  disposed = true;
  watcherStore.stopSyncInterval();
});

// Start/stop sync when level changes
watch(
  () => watcherStore.watcherLevel,
  (level) => {
    watcherStore.stopSyncInterval();
    if (level === 2 && isTauri.value) {
      watcherStore.startSyncInterval();
    }
  },
);

function setLevel(level: WatcherLevel) {
  if (level === watcherStore.watcherLevel) return;
  $q.dialog({
    title: 'confirm security change',
    message: 'enter your current password to change the watcher level',
    prompt: {
      model: '',
      type: 'password',
      isValid: (value: string) => value.length > 0,
    },
    cancel: true,
    persistent: true,
  }).onOk(async (password: string) => {
    try {
      const ok = await watcherStore.updateSettings({
        watcherLevel: level,
        currentPassword: password,
      });
      if (ok) {
        $q.notify({
          type: 'positive',
          message: `watcher set to ${watcherStore.levelLabel}`,
          position: 'bottom-right',
        });
        await watcherStore.loadLogs();
      }
    } catch {
      $q.notify({
        type: 'negative',
        message: 'failed to update watcher level',
        position: 'bottom-right',
      });
    }
  });
}

function beginChangeEmail() {
  isVerifying.value = false;
  verificationCode.value = '';
  alertEmailInput.value =
    watcherStore.pendingAlertEmail || watcherStore.alertEmail || watcherStore.accountEmail || '';
}

async function startVerification() {
  const email = (alertEmailInput.value.trim() || watcherStore.accountEmail || '').trim();

  if (!email || !currentPassword.value) {
    $q.notify({
      type: 'negative',
      message: 'enter an email address and your current password',
      position: 'bottom-right',
    });
    return;
  }

  savingEmail.value = true;
  try {
    const result = await watcherStore.requestAlertEmailVerification(email, currentPassword.value);
    if (result?.success) {
      isVerifying.value = true;
      verificationCode.value = '';
      currentPassword.value = '';
      alertEmailInput.value = email;
      $q.notify({
        type: 'positive',
        message: `verification code sent to ${result.data?.pendingAlertEmail || email}`,
        position: 'bottom-right',
      });
    } else {
      throw new Error(result?.error || 'failed to start verification');
    }
  } catch {
    $q.notify({ type: 'negative', message: 'failed to save email', position: 'bottom-right' });
  } finally {
    savingEmail.value = false;
  }
}

async function confirmVerification() {
  if (verificationCode.value.trim().length !== 6) {
    $q.notify({ type: 'negative', message: 'enter the 6-digit code', position: 'bottom-right' });
    return;
  }

  savingEmail.value = true;
  try {
    const result = await watcherStore.confirmAlertEmailVerification(verificationCode.value.trim());
    if (result?.success) {
      isVerifying.value = false;
      verificationCode.value = '';
      alertEmailInput.value = watcherStore.alertEmail || watcherStore.accountEmail || '';
      $q.notify({
        type: 'positive',
        message: 'alert email verified and saved',
        position: 'bottom-right',
      });
    } else {
      throw new Error(result?.error || 'verification failed');
    }
  } catch {
    $q.notify({ type: 'negative', message: 'failed to verify code', position: 'bottom-right' });
  } finally {
    savingEmail.value = false;
  }
}

async function cancelVerification() {
  savingEmail.value = true;
  try {
    await watcherStore.cancelPendingAlertEmail();
    isVerifying.value = false;
    verificationCode.value = '';
    alertEmailInput.value = watcherStore.alertEmail || watcherStore.accountEmail || '';
    $q.notify({
      type: 'positive',
      message: 'email verification cancelled',
      position: 'bottom-right',
    });
  } catch {
    $q.notify({
      type: 'negative',
      message: 'failed to cancel verification',
      position: 'bottom-right',
    });
  } finally {
    savingEmail.value = false;
  }
}

async function claimNow() {
  claiming.value = true;
  try {
    const count = await watcherStore.claimPendingLogs();
    $q.notify({
      type: count > 0 ? 'positive' : 'info',
      message: count > 0 ? `claimed ${count} event${count > 1 ? 's' : ''}` : 'no pending events',
      position: 'bottom-right',
    });
  } catch {
    $q.notify({ type: 'negative', message: 'claim failed', position: 'bottom-right' });
  } finally {
    claiming.value = false;
  }
}

function confirmClearLogs() {
  $q.dialog({
    title: 'clear local logs',
    message: 'permanently delete all local watcher logs?',
    ok: { label: 'clear', flat: true, color: 'negative' },
    cancel: { label: 'cancel', flat: true, color: 'grey' },
  }).onOk(async () => {
    const ok = await watcherStore.clearLocalLogs();
    if (ok === false) {
      // Either not running in Tauri, or the DB still has rows (e.g. an
      // in-flight claim re-added them). Tell the user so "clear did nothing"
      // never looks silent/broken.
      if (watcherStore.logs.length > 0) {
        $q.notify({
          type: 'warning',
          message: 'logs were re-synced after clearing — claim now and try again',
          position: 'bottom-right',
        });
      } else {
        $q.notify({
          type: 'negative',
          message: 'clearing failed (desktop only)',
          position: 'bottom-right',
        });
      }
      return;
    }
    $q.notify({ type: 'positive', message: 'local logs cleared', position: 'bottom-right' });
  });
}
</script>

<style scoped>
.watcher-level-option {
  border: 1px solid var(--dash-border);
  border-radius: 4px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.15s ease;
  background: var(--dash-card);
}
.watcher-level-option:focus-visible {
  outline: 2px solid var(--dash-text);
  outline-offset: 3px;
}
.watcher-level-option:hover {
  border-color: var(--dash-border-hover);
  background: #0a0a0a;
}
.watcher-level-active {
  border-color: var(--primary) !important;
  background: rgba(255, 0, 0, 0.04) !important;
}

.watcher-radio {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--dash-border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.15s;
}
.watcher-radio.active {
  border-color: var(--primary);
}
.watcher-radio-inner {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
}
</style>

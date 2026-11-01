<template>
  <q-dialog
    v-for="alert in securityStore.pendingLoginAlerts"
    :key="alert.sessionId"
    :model-value="true"
    persistent
  >
    <q-card class="device-login-card" dark>
      <q-card-section>
        <div class="flex items-center gap-2 mb-2">
          <q-icon name="mdi-shield-alert" color="primary" size="22px" />
          <span class="text-primary font-bold text-sm lowercase tracking-wide"
            >new login detected</span
          >
        </div>
        <p class="text-muted text-xs m-0 mb-3">
          your account was logged in from another device. if this was you, mark it safe. otherwise
          log that device out.
        </p>
        <div class="device-login-info">
          <div><span class="label">device</span> {{ alert.deviceName || 'unknown' }}</div>
          <div v-if="alert.ipHash">
            <span class="label">network</span> protected hash {{ alert.ipHash.slice(0, 8) }}
          </div>
          <div v-if="alert.createdAt">
            <span class="label">time</span> {{ formatTime(alert.createdAt) }}
          </div>
        </div>
      </q-card-section>
      <q-card-actions align="right" class="gap-2">
        <q-btn
          flat
          no-caps
          label="log out device"
          class="text-negative"
          :loading="securityStore.loadingSessionId === alert.sessionId"
          @click="revoke(alert)"
        />
        <q-btn
          flat
          no-caps
          label="mark as safe"
          color="primary"
          :loading="securityStore.loadingSessionId === alert.sessionId"
          @click="trust(alert)"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { useQuasar } from 'quasar';
import { useSecurityStore, type AccountLoginAlert } from 'src/stores/security';

const $q = useQuasar();
const securityStore = useSecurityStore();

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function revoke(alert: AccountLoginAlert) {
  securityStore.loadingSessionId = alert.sessionId;
  try {
    await securityStore.revokeRemoteSession(alert.sessionId);
    $q.notify({ type: 'positive', message: 'remote session logged out', timeout: 2500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed to log out device';
    $q.notify({ type: 'negative', message: msg, timeout: 3000 });
  } finally {
    securityStore.loadingSessionId = null;
  }
}

async function trust(alert: AccountLoginAlert) {
  securityStore.loadingSessionId = alert.sessionId;
  try {
    await securityStore.markSessionSafe(alert.sessionId, alert.identityPub);
    $q.notify({
      type: 'positive',
      message: 'device marked safe — contacts will not see suspicious activity from it',
      timeout: 3500,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed to mark device safe';
    $q.notify({ type: 'negative', message: msg, timeout: 3000 });
  } finally {
    securityStore.loadingSessionId = null;
  }
}
</script>

<style scoped>
.device-login-card {
  min-width: 320px;
  max-width: 420px;
  background: var(--dash-card, #111);
  border: 1px solid var(--dash-border, rgba(255, 255, 255, 0.08));
}

.device-login-info {
  display: grid;
  gap: 6px;
  font-family: monospace;
  font-size: 11px;
  color: var(--dash-text-muted, #9ca3af);
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--dash-border, rgba(255, 255, 255, 0.06));
}

.device-login-info .label {
  color: var(--dash-accent, #dc143c);
  margin-right: 6px;
  text-transform: lowercase;
}
</style>

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
            performance
          </h1>
        </div>
        <p class="text-muted text-xs m-0">device-local behavior for lighter rendering</p>
      </div>
    </div>

    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="section-title">performance mode</div>
        <p class="text-muted text-xs mb-4">
          Stored on this device only. When enabled, mourn disables the heaviest animated surfaces so
          the webview has less work to do.
        </p>

        <label class="toggle-item compact mb-4 performance-toggle-row">
          <input v-model="performanceMode" type="checkbox" />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">performance mode</span>
            <span class="toggle-desc">
              turn off heavy boot screens, cursor effects, and motion-heavy surfaces
            </span>
          </div>
        </label>

        <div class="grid gap-3 text-xs text-muted">
          <div class="rounded border border-solid border-dash-border bg-dash-bg px-4 py-3">
            <span class="text-primary font-bold">enabled:</span> boot overlays, animated graveyard
            ritual, and cursor effects are suppressed.
          </div>
          <div class="rounded border border-solid border-dash-border bg-dash-bg px-4 py-3">
            <span class="text-primary font-bold">scope:</span> this setting stays on the current
            device and does not sync with your profile.
          </div>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useDevicePreferencesStore } from 'src/stores/devicePreferences';

const devicePreferencesStore = useDevicePreferencesStore();

onMounted(() => {
  devicePreferencesStore.hydrate();
});

const performanceMode = computed({
  get: () => devicePreferencesStore.performanceMode,
  set: (value: boolean) => devicePreferencesStore.setPerformanceMode(value),
});
</script>

<style scoped>
.performance-toggle-row {
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.performance-toggle-row .toggle-info {
  min-width: 0;
  order: 1;
}

.performance-toggle-row .toggle-label {
  color: var(--primary);
}

.performance-toggle-row .toggle-desc {
  line-height: 1.45;
}

.performance-toggle-row input {
  order: 2;
}

.performance-toggle-row .toggle-switch {
  order: 3;
}
</style>

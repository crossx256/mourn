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
            presets
          </h1>
        </div>
        <p class="text-muted text-xs m-0">save &amp; swap entire profile looks</p>
      </div>
    </div>

    <!-- Create / hint card -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">profile presets</div>
        <p class="text-muted text-xs mb-4">
          Save your current full customization as a named preset, then apply or delete it anytime.
          You can keep up to {{ MAX_PRESETS }} presets. Each preset stores every customization
          setting on your profile.
        </p>
        <div class="flex items-end gap-3">
          <q-input
            v-model="newPresetName"
            label="preset name"
            dark
            filled
            square
            dense
            maxlength="60"
            class="flex-1 dashboard-no-label-field"
            @keyup.enter="createPreset"
          />
          <q-btn
            unelevated
            no-caps
            color="primary"
            label="save current look"
            icon="mdi-content-save"
            :disable="!newPresetName.trim()"
            @click="createPreset"
          />
        </div>
        <div v-if="presetCount >= MAX_PRESETS" class="text-[10px] text-negative mt-2">
          you've reached the {{ MAX_PRESETS }}-preset limit — delete one to save a new preset.
        </div>
      </q-card-section>
    </q-card>

    <!-- Presets list -->
    <q-card flat bordered dark class="dash-card">
      <q-card-section>
        <div class="dash-section-title">saved presets</div>

        <div v-if="store.isLoadingPresets" class="text-dash-muted text-xs py-4">
          loading presets...
        </div>
        <div v-else-if="!store.presets.length" class="text-dash-muted text-xs py-4">
          no presets yet — save your current profile look above.
        </div>

        <q-list v-else dark separator>
          <q-item v-for="preset in store.presets" :key="preset.id" class="preset-row">
            <q-item-section>
              <q-item-label class="text-dash-text">{{ preset.name }}</q-item-label>
              <q-item-label caption class="text-dash-muted text-[10px] font-mono">
                updated {{ formatDate(preset.updatedAt) }}
              </q-item-label>
            </q-item-section>

            <q-item-section side class="flex flex-row items-center gap-1">
              <q-btn
                flat
                dense
                unelevated
                color="primary"
                icon="mdi-check-bold"
                size="sm"
                :loading="applyingId === preset.id"
                @click="applyPreset(preset.id)"
              >
                <q-tooltip>apply this preset to my profile</q-tooltip>
              </q-btn>
              <q-btn
                flat
                dense
                unelevated
                icon="mdi-pencil-outline"
                size="sm"
                color="grey-6"
                @click="startRename(preset)"
              >
                <q-tooltip>rename</q-tooltip>
              </q-btn>
              <q-btn
                flat
                dense
                unelevated
                icon="mdi-delete-outline"
                size="sm"
                color="negative"
                :loading="deletingId === preset.id"
                @click="deletePreset(preset)"
              >
                <q-tooltip>delete</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>

    <!-- Rename dialog -->
    <q-dialog v-model="renameDialogOpen">
      <q-card
        class="bg-dash-panel border border-solid border-dash-border text-dash-text"
        style="min-width: 320px"
      >
        <q-card-section class="flex items-center justify-between">
          <div class="text-sm font-semibold lowercase tracking-wide">rename preset</div>
          <q-btn flat round dense icon="mdi-close" v-close-popup />
        </q-card-section>
        <q-separator class="bg-dash-border" />
        <q-card-section>
          <q-input
            v-model="renameValue"
            dark
            filled
            square
            dense
            maxlength="60"
            label="preset name"
            class="dashboard-no-label-field"
          />
        </q-card-section>
        <q-card-actions align="right" class="gap-2">
          <q-btn flat no-caps label="cancel" color="grey-5" v-close-popup />
          <q-btn
            unelevated
            no-caps
            color="primary"
            label="save"
            :disable="!renameValue.trim()"
            @click="confirmRename"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useDashboardStore } from 'src/stores/dashboard';
import type { ProfilePreset } from 'src/stores/dashboard';

const $q = useQuasar();
const store = useDashboardStore();

onMounted(() => {
  if (!store.presets.length) void store.fetchPresets();
});

const MAX_PRESETS = 5;

const newPresetName = ref('');
const applyingId = ref('');
const deletingId = ref('');

const presetCount = computed(() => store.presets.length);

const renameDialogOpen = ref(false);
const renameValue = ref('');
const renameTarget = ref<ProfilePreset | null>(null);

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return 'unknown';
  }
}

async function createPreset() {
  const name = newPresetName.value.trim();
  if (!name) return;
  if (presetCount.value >= MAX_PRESETS) {
    $q.notify({
      type: 'negative',
      message: `You can save up to ${MAX_PRESETS} presets.`,
      position: 'bottom-right',
    });
    return;
  }
  const res = await store.createPreset(name);
  $q.notify({
    type: res.success ? 'positive' : 'negative',
    message: res.success ? 'Preset saved' : res.error || 'Failed to save preset',
    position: 'bottom-right',
  });
  if (res.success) newPresetName.value = '';
}

async function applyPreset(id: string) {
  applyingId.value = id;
  const res = await store.applyPreset(id);
  applyingId.value = '';
  $q.notify({
    type: res.success ? 'positive' : 'negative',
    message: res.success ? 'Preset applied to your profile' : res.error || 'Failed to apply preset',
    position: 'bottom-right',
  });
}

function startRename(preset: ProfilePreset) {
  renameTarget.value = preset;
  renameValue.value = preset.name;
  renameDialogOpen.value = true;
}

async function confirmRename() {
  if (!renameTarget.value) return;
  const name = renameValue.value.trim();
  if (!name) return;
  const res = await store.updatePreset(renameTarget.value.id, { name });
  if (!res.success) {
    $q.notify({
      type: 'negative',
      message: res.error || 'Failed to rename preset',
      position: 'bottom-right',
    });
  }
  renameDialogOpen.value = false;
  renameTarget.value = null;
}

async function deletePreset(preset: ProfilePreset) {
  deletingId.value = preset.id;
  const res = await store.deletePreset(preset.id);
  deletingId.value = '';
  $q.notify({
    type: res.success ? 'positive' : 'negative',
    message: res.success ? 'Preset deleted' : res.error || 'Failed to delete preset',
    position: 'bottom-right',
  });
}
</script>

<style scoped>
.preset-row {
  border-bottom: 1px solid var(--dash-border, #1a1a1a);
}
.preset-row:last-child {
  border-bottom: none;
}
</style>

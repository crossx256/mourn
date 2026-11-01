<template>
  <div class="client-theme-settings">
    <div class="dash-back-inline mb-6">
      <q-btn
        v-if="$q.screen.lt.md"
        flat
        round
        dense
        icon="mdi-arrow-left"
        to="/"
        color="primary"
        aria-label="back to home"
      />
      <h1 class="text-xl text-primary m-0 lowercase">client theme</h1>
    </div>
    <p class="text-muted text-xs">
      Client chrome only, not your public profile. Saved on this device, with optional account sync.
    </p>
    <q-card flat bordered dark class="dash-card mb-5"
      ><q-card-section>
        <div class="dash-section-title">palette</div>
        <div class="theme-choice-grid mb-4" data-field="theme-preset">
          <q-btn
            v-for="(_, preset) in PRESETS"
            :key="preset"
            :label="preset"
            :outline="theme.prefs.preset !== preset"
            color="primary"
            :aria-pressed="theme.prefs.preset === preset"
            @click="edit({ preset, accent: null })"
          />
        </div>
        <div class="dash-section-title">accent</div>
        <div class="theme-color-options" data-field="theme-accent">
          <q-btn outline label="palette default" @click="edit({ accent: null })" />
          <button
            v-for="accent in ACCENTS"
            :key="accent"
            class="theme-swatch"
            :style="{ background: accent }"
            :aria-label="`accent ${accent}`"
            :aria-pressed="theme.prefs.accent === accent"
            @click="edit({ accent })"
          />
        </div>
        <label class="theme-field-label" for="theme-accent-picker">custom accent color</label>
        <div class="theme-color-control">
          <input
            id="theme-accent-picker"
            data-field="theme-accent-picker"
            type="color"
            :value="resolvedColors.accent"
            :aria-invalid="!!accentWarning"
            aria-describedby="theme-accent-warning"
            @input="edit({ accent: ($event.target as HTMLInputElement).value })"
          />
          <span>{{ resolvedColors.accent }}</span>
        </div>
        <p
          id="theme-accent-warning"
          role="status"
          class="text-muted text-xs"
          data-field="theme-accent-warning"
        >
          {{
            accentWarning || 'Choose any color with at least 3:1 contrast against the background.'
          }}
        </p>
      </q-card-section></q-card
    >
    <q-card flat bordered dark class="dash-card mb-5"
      ><q-card-section>
        <div class="dash-section-title">size &amp; motion</div>
        <label class="theme-field-label" for="theme-density">interface density</label>
        <q-select
          id="theme-density"
          dark
          outlined
          dense
          class="dashboard-no-label-field mb-3"
          data-field="theme-density"
          :model-value="theme.prefs.density"
          :options="['compact', 'comfortable', 'spacious']"
          @update:model-value="edit({ density: $event })"
        />
        <label v-if="isDesktopBuild" class="theme-field-label" for="theme-scale"
          >desktop UI scale</label
        >
        <q-select
          v-if="isDesktopBuild"
          id="theme-scale"
          dark
          outlined
          dense
          class="dashboard-no-label-field mb-3"
          data-field="theme-scale"
          :model-value="theme.prefs.scale"
          :options="[0.9, 1, 1.1, 1.25]"
          @update:model-value="edit({ scale: $event })"
        />
        <p v-else class="text-muted text-xs">
          Mobile uses density only; global zoom is never applied.
        </p>
        <label class="theme-field-label" for="theme-chat-size">chat text size</label>
        <q-select
          id="theme-chat-size"
          dark
          outlined
          dense
          class="dashboard-no-label-field mb-3"
          data-field="theme-chat-size"
          :model-value="theme.prefs.extras.chatTextSize"
          :options="['sm', 'md', 'lg']"
          @update:model-value="extras({ chatTextSize: $event })"
        />
        <label class="theme-field-label" for="theme-chat-density">chat density</label>
        <q-select
          id="theme-chat-density"
          dark
          outlined
          dense
          class="dashboard-no-label-field mb-3"
          data-field="theme-chat-density"
          :model-value="theme.prefs.extras.chatDensity"
          :options="['compact', 'comfortable']"
          @update:model-value="extras({ chatDensity: $event })"
        />
        <label class="toggle-item compact" data-field="theme-font">
          <input
            type="checkbox"
            :checked="theme.prefs.font === 'opendyslexic'"
            @change="
              edit({ font: ($event.target as HTMLInputElement).checked ? 'opendyslexic' : 'mono' })
            "
          />
          <div class="toggle-switch"></div>
          <span class="toggle-label">OpenDyslexic font (bundled, client text only)</span>
        </label>
        <label class="toggle-item compact" data-field="theme-motion"
          ><input
            type="checkbox"
            :checked="theme.prefs.extras.reduceMotion"
            @change="extras({ reduceMotion: ($event.target as HTMLInputElement).checked })"
          />
          <div class="toggle-switch"></div>
          <span class="toggle-label">reduce motion / performance mode</span></label
        >
        <label class="toggle-item compact" data-field="theme-haptics"
          ><input type="checkbox" :checked="hapticsEnabled" @change="onHapticsToggle" />
          <div class="toggle-switch"></div>
          <span class="toggle-label">haptic feedback (vibration on taps and sends)</span></label
        >
      </q-card-section></q-card
    >
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="section-title">background effects</div>
        <p class="text-muted text-xs mb-4">
          Preview behind client screens, never your public profile. Choose none to turn effects off.
        </p>
        <div class="theme-choice-grid mb-4" data-field="theme-fx-pattern">
          <q-btn
            v-for="pattern in patterns"
            :key="pattern"
            :label="pattern"
            :outline="theme.prefs.fx.pattern !== pattern"
            color="primary"
            :aria-pressed="theme.prefs.fx.pattern === pattern"
            :disable="effectsDisabled && pattern !== 'none'"
            @click="setPattern(pattern)"
          />
        </div>
        <p v-if="effectsDisabled" class="text-muted text-xs" data-field="theme-fx-note">
          Effects are paused while reduced motion or performance mode is enabled. Your choice is
          kept; none always turns effects off.
        </p>
        <p
          v-if="batteryWarning"
          role="status"
          class="text-muted text-xs"
          data-field="theme-fx-battery"
        >
          Animated backgrounds can increase battery use on mobile. Choose none or dots for lighter
          rendering.
        </p>
        <div class="section-title">effect color</div>
        <div class="theme-color-options mb-4" data-field="theme-fx-color">
          <q-btn
            outline
            label="palette color"
            :disable="effectsDisabled"
            @click="fx({ color: null })"
          />
          <button
            v-for="color in ACCENTS"
            :key="color"
            class="theme-swatch"
            :style="{ background: color }"
            :aria-label="`effect color ${color}`"
            :aria-pressed="theme.prefs.fx.color === color"
            :disabled="effectsDisabled"
            @click="fx({ color })"
          />
        </div>
        <label class="theme-field-label" for="theme-fx-color-picker">custom effect color</label>
        <div class="theme-color-control mb-4">
          <input
            id="theme-fx-color-picker"
            data-field="theme-fx-color-picker"
            type="color"
            :value="theme.prefs.fx.color || resolvedColors.accent"
            :disabled="effectsDisabled"
            @input="fx({ color: ($event.target as HTMLInputElement).value })"
          />
          <span>{{ theme.prefs.fx.color || 'palette color' }}</span>
        </div>
        <div class="theme-field-label">effect intensity</div>
        <q-slider
          data-field="theme-fx-intensity"
          aria-label="effect intensity"
          :model-value="theme.prefs.fx.intensity"
          :min="0"
          :max="1"
          :step="0.05"
          :disable="effectsDisabled"
          label
          @update:model-value="$event !== null && fx({ intensity: $event })"
        />
        <div class="theme-field-label">effect size</div>
        <q-slider
          data-field="theme-fx-size"
          aria-label="effect size"
          :model-value="theme.prefs.fx.size"
          :min="0.5"
          :max="2"
          :step="0.05"
          :disable="effectsDisabled"
          label
          @update:model-value="$event !== null && fx({ size: $event })"
        />
        <label class="toggle-item compact mb-4" data-field="theme-frosted">
          <input
            type="checkbox"
            :checked="theme.prefs.frosted"
            @change="edit({ frosted: ($event.target as HTMLInputElement).checked })"
          />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">frosted surfaces</span>
            <span class="toggle-desc"
              >translucent panels where supported; opaque fallback otherwise</span
            >
          </div>
        </label>
      </q-card-section>
    </q-card>
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="section-title">theme codes</div>
        <p class="text-muted text-xs">
          Share a look, not device or account settings. Imports are previews until Save theme.
        </p>
        <q-btn outline label="export code" @click="exportCode" />
        <label v-if="exportedCode" class="theme-field-label mt-3" for="theme-code-output"
          >theme code — select to copy</label
        >
        <q-input
          v-if="exportedCode"
          id="theme-code-output"
          :model-value="exportedCode"
          readonly
          dark
          outlined
          dense
          class="dashboard-no-label-field"
          type="textarea"
          data-field="theme-code-output"
        />
        <label class="theme-field-label mt-3" for="theme-code-input">paste theme code</label>
        <q-input
          id="theme-code-input"
          v-model="codeInput"
          dark
          outlined
          dense
          class="dashboard-no-label-field"
          type="textarea"
          maxlength="1536"
          data-field="theme-code-input"
        />
        <q-btn
          outline
          class="mt-3"
          label="preview code"
          :disable="!codeInput"
          @click="importCode"
        />
        <p role="status" class="text-muted text-xs" data-field="theme-code-status">
          {{ codeStatus }}
        </p>
      </q-card-section>
    </q-card>
    <q-card flat bordered dark class="dash-card mb-5"
      ><q-card-section>
        <div class="dash-section-title">
          personal presets
          <span v-if="!dashboard.isDonator" class="dash-premium-badge">donator</span>
        </div>
        <label class="theme-field-label" for="theme-preset-name">preset name</label>
        <q-input
          id="theme-preset-name"
          v-model="name"
          dark
          outlined
          dense
          class="dashboard-no-label-field"
          maxlength="60"
          data-field="theme-preset-name"
        />
        <q-btn
          class="mt-3"
          outline
          label="save current as preset"
          :disable="!dashboard.isDonator || theme.prefs.saved.length >= 5 || !validName"
          @click="addPreset"
        />
        <p class="text-muted text-xs">
          Up to five. Preset changes are committed with Save theme below.
        </p>
        <div v-for="saved in theme.prefs.saved" :key="saved.id" class="flex gap-2 mb-2">
          <q-btn
            outline
            :label="saved.name"
            @click="
              edit({
                preset: saved.preset,
                accent: saved.accent,
                density: saved.density ?? 'comfortable',
                fx: { ...(saved.fx ?? defaults().fx) },
                frosted: saved.frosted ?? false,
                font: saved.font ?? 'mono',
              })
            "
          />
          <q-btn
            flat
            label="delete"
            :aria-label="`delete ${saved.name}`"
            @click="
              edit({ saved: theme.prefs.saved.filter((s: { id: string }) => s.id !== saved.id) })
            "
          />
        </div> </q-card-section
    ></q-card>
    <div class="flex gap-2">
      <q-btn
        color="primary"
        label="save theme"
        :disable="!theme.dirty && !theme.pending"
        @click="theme.save()"
      />
      <q-btn outline label="cancel preview" :disable="!theme.dirty" @click="theme.cancel()" />
      <q-btn flat label="reset to default" @click="theme.reset()" />
    </div>
    <p role="status" class="text-muted text-xs">
      {{
        theme.error ||
        (theme.pending
          ? 'Saved on this device; account sync pending.'
          : theme.dirty
            ? 'Live preview — not saved.'
            : 'Theme saved on this device.')
      }}
    </p>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useQuasar } from 'quasar';
import { useDevicePreferencesStore } from 'src/stores/devicePreferences';
import { useThemeStore } from 'src/stores/theme';
import { useDashboardStore } from 'src/stores/dashboard';
import { PRESETS } from 'src/theme/presets';
import { ACCENTS } from 'src/theme/ramp';
import { luminance, resolveTheme } from 'src/theme/apply';
import { clone, defaults, type BackdropPattern, type ThemePrefs } from 'src/theme/preferences';
import { decodeThemeCode, encodeThemeCode, validThemeName } from 'src/theme/codes';
import { isDesktopBuild } from 'src/utils/platform';
import { isHapticsEnabled, setHapticsEnabled } from 'src/composables/useHaptics';
const theme = useThemeStore(),
  dashboard = useDashboardStore(),
  name = ref('');
const $q = useQuasar();
const device = useDevicePreferencesStore();
const systemReducedMotion = ref(false);
const effectsDisabled = computed(
  () => systemReducedMotion.value || device.performanceMode || theme.prefs.extras.reduceMotion,
);
const patterns: BackdropPattern[] = [
  'none',
  'dots',
  'synapse',
  'rain',
  'constellations',
  'perlin-flow',
  'petals',
  'sparkles',
  'embers',
];
const batteryWarning = ref(false);
const batteryKey = 'mourn_theme_fx_battery_warned_v1';
let warnedThisSession = false;
let motionQuery: MediaQueryList | undefined;
const updateMotion = () => {
  systemReducedMotion.value = motionQuery?.matches ?? false;
};
onMounted(() => {
  device.hydrate();
  motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  updateMotion();
  motionQuery?.addEventListener('change', updateMotion);
});
function warnBattery(pattern: BackdropPattern) {
  if (!$q.screen.lt.md || pattern === 'none' || pattern === 'dots' || warnedThisSession) return;
  warnedThisSession = true;
  try {
    if (localStorage.getItem(batteryKey) === '1') return;
    localStorage.setItem(batteryKey, '1');
  } catch {
    /* Still warn once this session when storage is unavailable. */
  }
  batteryWarning.value = true;
}
function setPattern(pattern: BackdropPattern) {
  if (pattern !== 'none' && effectsDisabled.value) return;
  edit({ fx: { ...theme.prefs.fx, pattern } });
}
function fx(patch: Partial<ThemePrefs['fx']>) {
  if (!effectsDisabled.value) edit({ fx: { ...theme.prefs.fx, ...patch } });
}
const codeInput = ref('');
const exportedCode = ref('');
const codeStatus = ref('');
function importCode() {
  const decoded = decodeThemeCode(codeInput.value);
  if (!decoded) {
    codeStatus.value = 'Invalid theme code. Nothing was changed.';
    return;
  }
  const { name: importedName, ...snapshot } = decoded;
  if (!edit(snapshot)) {
    codeStatus.value = accentWarning.value;
    return;
  }
  name.value = importedName;

  codeStatus.value = `Previewing ${importedName}. Save it as a personal preset below (donator, up to five), or Save theme to keep this look.`;
}
async function exportCode() {
  exportedCode.value = '';
  try {
    const p = theme.prefs;
    exportedCode.value = encodeThemeCode({
      v: 1,
      name: name.value || 'my theme',
      preset: p.preset,
      accent: p.accent,
      density: p.density,
      fx: { ...p.fx },
      frosted: p.frosted,
      font: p.font,
    });
  } catch {
    codeStatus.value =
      'This look cannot be exported. Check the name and choose an accent with sufficient contrast.';
    return;
  }
  try {
    await navigator.clipboard.writeText(exportedCode.value);
    codeStatus.value = 'Theme code copied.';
  } catch {
    codeStatus.value = 'Clipboard unavailable. Select and copy the code above.';
  }
}
const hapticsEnabled = ref(isHapticsEnabled());
function onHapticsToggle(event: Event) {
  const next = (event.target as HTMLInputElement).checked;
  setHapticsEnabled(next);
  hapticsEnabled.value = next;
}
const validName = computed(() => validThemeName(name.value));
const resolvedColors = computed(() => resolveTheme(theme.prefs));
const accentWarning = ref('');
function edit(patch: Partial<ThemePrefs>) {
  const next = { ...clone(theme.prefs), ...patch };
  if (next.accent && !/^#[0-9a-f]{6}$/i.test(next.accent)) {
    accentWarning.value = 'Choose a valid six-digit hex color. Nothing was changed.';
    return false;
  }
  const colors = resolveTheme(next);
  const accent = luminance(colors.accent);
  const background = luminance(colors.bg);
  if ((Math.max(accent, background) + 0.05) / (Math.min(accent, background) + 0.05) < 3) {
    accentWarning.value =
      'Accent needs at least 3:1 contrast against the background. Nothing was changed.';
    return false;
  }
  accentWarning.value = '';
  theme.preview(next);
  if (patch.fx && !effectsDisabled.value) warnBattery(patch.fx.pattern);
  return true;
}
function extras(patch: Partial<ThemePrefs['extras']>) {
  edit({ extras: { ...theme.prefs.extras, ...patch } });
}
function addPreset() {
  if (!dashboard.isDonator || theme.prefs.saved.length >= 5 || !validName.value) return;
  const p = theme.prefs;
  edit({
    saved: [
      ...p.saved,
      {
        id: crypto.randomUUID(),
        name: name.value.trim(),
        preset: p.preset,
        accent: p.accent,
        density: p.density,
        fx: { ...p.fx },
        frosted: p.frosted,
        font: p.font,
      },
    ],
  });
  name.value = '';
}
onBeforeUnmount(() => {
  motionQuery?.removeEventListener('change', updateMotion);
});
</script>
<style scoped>
.client-theme-settings {
  min-width: 0;
}
.client-theme-settings .theme-choice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.client-theme-settings .theme-choice-grid :deep(.q-btn) {
  min-width: 0;
  min-height: 44px;
  padding: 8px;
}
.client-theme-settings .theme-choice-grid :deep(.q-btn__content) {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
.client-theme-settings .theme-color-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.client-theme-settings .theme-field-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.client-theme-settings .theme-color-control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
}
.client-theme-settings input[type='color'] {
  width: 64px;
  height: 44px;
  padding: 3px;
  cursor: pointer;
}
.client-theme-settings .dashboard-no-label-field {
  width: 100%;
  min-width: 0;
}
.client-theme-settings .dashboard-no-label-field :deep(.q-field__control) {
  min-height: 44px;
}
.client-theme-settings .toggle-item {
  min-height: 48px;
}
.client-theme-settings .toggle-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
@media (min-width: 600px) {
  .client-theme-settings .theme-choice-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.client-theme-settings .theme-swatch {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  border: 2px solid transparent;
  cursor: pointer;
}
.client-theme-settings .theme-swatch[aria-pressed='true'],
.client-theme-settings .theme-swatch:focus-visible {
  border-color: var(--white);
  outline: 1px solid var(--primary);
}
</style>

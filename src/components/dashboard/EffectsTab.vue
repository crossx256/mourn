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
            effects
          </h1>
        </div>
        <p class="text-muted text-xs m-0">animations, cursor effects, and audio</p>
      </div>
    </div>

    <q-card flat bordered dark class="dash-card mb-5" data-field="entrance-overlay">
      <q-card-section>
        <div class="dash-section-title">entrance overlay</div>
        <p class="text-muted text-xs mb-4">click-to-enter splash screen before your profile</p>

        <label class="toggle-item compact mb-4">
          <input type="checkbox" v-model="entranceOverlayEnabled" />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">enable entrance overlay</span>
            <span class="toggle-desc"></span>
          </div>
        </label>

        <div v-if="entranceOverlayEnabled" class="space-y-4">
          <q-input
            v-model="entranceText"
            placeholder="click to enter..."
            dark
            filled
            square
            hint="Shown on the click-to-enter splash screen"
            class="dashboard-no-label-field"
          />

          <q-expansion-item
            label="overlay text style"
            icon="mdi-format-text"
            dark
            dense
            header-class="text-muted text-xs"
          >
            <q-card dark class="bg-transparent">
              <q-card-section class="pt-2 grid grid-cols-2 gap-3">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted">color:</span>
                  <q-input
                    v-model="entranceTextColor"
                    dark
                    filled
                    square
                    dense
                    class="flex-1 dashboard-no-label-field"
                  >
                    <template #prepend>
                      <div
                        class="w-4 h-4 rounded-sm"
                        :style="{ background: entranceTextColor }"
                      ></div>
                    </template>
                    <template #append>
                      <q-icon name="mdi-eyedropper" class="cursor-pointer">
                        <q-popup-proxy><q-color v-model="entranceTextColor" dark /></q-popup-proxy>
                      </q-icon>
                    </template>
                  </q-input>
                </div>
                <q-input
                  v-model="entranceTextFont"
                  placeholder="Sour Gummy"
                  dark
                  filled
                  square
                  dense
                  hint="Google Font name"
                  class="dashboard-no-label-field"
                />
              </q-card-section>
            </q-card>
          </q-expansion-item>

          <!-- Overlay background color + transparency (backed by
               entranceOverlayColor / entranceOverlayOpacity, persisted by the backend) -->
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted">overlay color</span>
              <q-input
                v-model="entranceOverlayColor"
                dark
                filled
                square
                dense
                data-field="entrance-overlay-color"
              >
                <template #prepend>
                  <div
                    class="w-4 h-4 rounded-sm"
                    :style="{ background: entranceOverlayColor }"
                  ></div>
                </template>
                <template #append>
                  <q-icon name="mdi-eyedropper" class="cursor-pointer">
                    <q-popup-proxy><q-color v-model="entranceOverlayColor" dark /></q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>
            </div>
            <div>
              <div class="text-xs text-muted mb-2">
                transparency: {{ Math.round((entranceOverlayOpacity ?? 0.9) * 100) }}%
              </div>
              <q-slider
                v-model="entranceOverlayOpacity"
                :min="0"
                :max="1"
                :step="0.05"
                dark
                color="primary"
                thumb-size="12px"
                track-size="4px"
                data-field="entrance-overlay-opacity"
                :label-value="Math.round((entranceOverlayOpacity ?? 0.9) * 100) + '%'"
              />
            </div>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">animations</div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="text-xs text-muted mb-1 block">profile entrance</label>
            <select v-model="profileAnimation" class="mourn-select w-full">
              <option value="none">none</option>
              <option value="fade">fade in</option>
              <option value="glitch">glitch</option>
            </select>
          </div>

          <div>
            <label class="text-xs text-muted mb-1 block">username effect</label>
            <select v-model="usernameEffects" class="mourn-select w-full">
              <option value="">none</option>
              <option value="glow">glow pulse</option>
              <option value="rainbow">rainbow</option>
              <option value="glitch">glitch</option>
              <option value="shimmer-spin">shimmer spin</option>
              <option value="shimmer-wave">shimmer wave</option>
              <option value="shimmer-throb">shimmer throb</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="text-xs text-muted mb-1 block">bio animation</label>
            <select v-model="descriptionAnimation" class="mourn-select w-full">
              <option value="none">none</option>
              <option value="typewriter">typewriter</option>
              <option value="fade">fade in</option>
            </select>
          </div>
        </div>

        <div v-if="showUsernameGlowPicker" class="flex items-center gap-3 mb-4">
          <span class="text-xs text-muted">glow color:</span>
          <q-input v-model="usernameGlowColor" dark filled square dense class="w-40">
            <template #prepend>
              <div
                class="w-4 h-4 rounded-sm"
                :style="{ background: usernameGlowColor || '#ffffff' }"
              ></div>
            </template>
            <template #append>
              <q-icon name="mdi-eyedropper" class="cursor-pointer">
                <q-popup-proxy>
                  <q-color v-model="usernameGlowColor" dark />
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mb-5" data-field="title-glitch">
      <q-card-section>
        <div class="dash-section-title">title glitch</div>

        <label class="toggle-item compact">
          <input type="checkbox" v-model="titleGlitch" />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">animated browser tab title</span>
            <span class="toggle-desc"
              >glitch characters cycle through your profile title in the browser tab</span
            >
          </div>
        </label>

        <div v-if="titleGlitch" class="mt-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-muted">speed</span>
            <span class="text-[10px] text-muted">{{ titleGlitchSpeedLabel }}</span>
          </div>
          <q-slider
            v-model="titleGlitchSpeed"
            :min="0.5"
            :max="4.5"
            :step="0.5"
            dark
            color="primary"
            thumb-size="12px"
            track-size="4px"
          />
        </div>

        <div
          v-if="titleGlitch"
          class="title-glitch-preview mt-3 p-3 bg-[#0a0a0a] border border-solid border-[#1a1a1a] rounded"
        >
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-muted font-mono">tab:</span>
            <span class="text-xs text-primary font-mono tracking-wide">{{
              titleGlitchPreview
            }}</span>
          </div>
        </div>
      </q-card-section>
    </q-card>
    <q-card flat bordered dark class="dash-card mb-5" data-field="cursor">
      <q-card-section>
        <div class="dash-section-title">custom cursor</div>

        <div class="flex gap-2 mb-2">
          <q-input
            v-model="customCursor"
            dark
            filled
            square
            dense
            class="flex-1 dashboard-no-label-field"
            :error="!!cursorValidationError"
            :error-message="cursorValidationError"
            placeholder="https://.../cursor.png"
          >
            <template #append>
              <q-btn
                icon="mdi-upload"
                flat
                dense
                round
                color="primary"
                @click="triggerCursorUpload"
              >
                <q-tooltip>upload cursor file</q-tooltip>
              </q-btn>
            </template>
          </q-input>
        </div>

        <p class="text-[10px] text-muted mb-4">
          best results: <span class="text-primary">32x32px PNG</span>. larger images may not display
          as cursors in some browsers.
        </p>

        <div v-if="cursorUploadStatus" class="text-xs text-primary mb-4 animate-pulse">
          <i class="mdi mdi-loading mdi-spin mr-1"></i> {{ cursorUploadStatus }}
        </div>

        <div
          v-if="customCursor"
          class="cursor-preview-box flex items-center gap-3 p-4 bg-[#0a0a0a] border border-dashed border-[#333] rounded mb-4 transition-all hover:border-primary"
          :style="{ cursor: cursorCssValue }"
        >
          <div
            class="relative w-8 h-8 bg-[#111] rounded flex items-center justify-center border border-solid border-[#222]"
          >
            <img
              :src="customCursor"
              class="max-w-full max-h-full object-contain"
              @error="cursorValidationError = 'invalid image — check link'"
              @load="onCursorImageLoad"
            />
          </div>
          <div class="flex flex-col">
            <span class="text-xs font-medium text-white">hover here to preview</span>
            <span class="text-[10px] text-muted">{{ cursorSizeHint }}</span>
          </div>
          <q-btn
            flat
            dense
            icon="mdi-delete-outline"
            color="negative"
            size="sm"
            @click="customCursor = ''"
            class="ml-auto"
          />
        </div>

        <div class="mt-2">
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs text-muted">cursor size</label>
            <span class="text-[10px] text-muted">{{ cursorSize }}px</span>
          </div>
          <q-slider
            v-model="cursorSize"
            :min="8"
            :max="96"
            dark
            color="primary"
            thumb-size="12px"
            track-size="4px"
            :label-value="cursorSize + 'px'"
          />
          <p class="text-[10px] text-muted mt-1">
            browsers cap raster cursor images at ~32px; larger values take effect where supported
          </p>
        </div>

        <div class="mt-2">
          <label class="text-xs text-muted mb-1 block">cursor trail / effect</label>
          <select v-model="cursorEffect" class="mourn-select w-full">
            <option value="">none</option>
            <option value="spotlight">spotlight</option>
            <option value="neon-glow">neon glow</option>
            <option value="sparkle-dust">sparkle dust</option>
            <option value="cursor-trail">cursor trail</option>
            <option value="bubbles">bubbles</option>
            <option value="fairy-dust">fairy dust</option>
          </select>
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mb-5" data-field="audio">
      <q-card-section>
        <div class="dash-section-title">profile music</div>

        <label class="toggle-item compact mb-4">
          <input type="checkbox" v-model="musicEnabled" />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">enable background music</span>
            <span class="toggle-desc"></span>
          </div>
        </label>

        <div v-if="musicEnabled" class="space-y-4">
          <div class="flex gap-2">
            <q-input
              v-model="musicUrl"
              hint="MP3, OGG, or WAV"
              dark
              filled
              square
              class="flex-1 dashboard-no-label-field"
              placeholder="https://.../audio.mp3"
            >
              <template #append>
                <q-btn
                  icon="mdi-upload"
                  flat
                  dense
                  round
                  color="primary"
                  @click="triggerMusicUpload"
                >
                  <q-tooltip>upload audio</q-tooltip>
                </q-btn>
              </template>
            </q-input>
          </div>
          <div v-if="musicUploadStatus" class="text-xs text-muted">{{ musicUploadStatus }}</div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <div class="text-xs text-muted mb-2">
                volume: {{ Math.round((musicVolume ?? 0.5) * 100) }}%
              </div>
              <q-slider
                v-model="musicVolume"
                :min="0"
                :max="1"
                :step="0.01"
                dark
                color="primary"
                thumb-size="12px"
                track-size="4px"
              />
            </div>
            <div>
              <label class="toggle-item compact mb-2">
                <input type="checkbox" v-model="musicAutoplay" />
                <div class="toggle-switch"></div>
                <div class="toggle-info">
                  <span class="toggle-label">autoplay</span>
                  <span class="toggle-desc"></span>
                </div>
              </label>
              <label class="toggle-item compact">
                <input type="checkbox" v-model="musicLoop" />
                <div class="toggle-switch"></div>
                <div class="toggle-info">
                  <span class="toggle-label">loop</span>
                  <span class="toggle-desc"></span>
                </div>
              </label>
            </div>
          </div>

          <!-- <div
            v-if="musicUrl"
            class="p-3 bg-[#0a0a0a] border border-solid border-[#1a1a1a] rounded"
          >
            <audio
              ref="audioPreviewRef"
              :src="musicUrl"
              :loop="musicLoop"
              controls
              class="w-full h-8"
            ></audio>
            <p class="text-[10px] text-muted mt-1">
              <i class="mdi mdi-information-outline"></i> visitors must click unmute to hear music
            </p>
          </div> -->
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">branding</div>
      </q-card-section>
    </q-card>

    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">seo &amp; metadata</div>
        <p class="text-muted text-xs mb-4">customize how your profile appears when shared</p>

        <div class="space-y-4">
          <q-input
            v-model="seoTitle"
            maxlength="60"
            dark
            filled
            dense
            square
            placeholder="page title"
            class="dashboard-no-label-field"
          />

          <q-input
            v-model="seoDescription"
            type="textarea"
            :rows="3"
            maxlength="160"
            dark
            filled
            square
            placeholder="short description for shared links"
          />
        </div>
      </q-card-section>
    </q-card>

    <q-file
      ref="cursorPicker"
      v-model="cursorFile"
      accept="image/png,image/gif,image/x-icon"
      class="hidden"
      @update:model-value="handleCursorUpload"
    />

    <q-file
      ref="musicPicker"
      v-model="musicFile"
      accept="audio/mpeg,audio/ogg,audio/wav"
      class="hidden"
      @update:model-value="handleMusicUpload"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue';
import { useQuasar } from 'quasar';
import { useDashboardStore } from 'src/stores/dashboard';
import type { QFile } from 'quasar';

const $q = useQuasar();
const dashboardStore = useDashboardStore();

// Defensive: fallback profile object to avoid undefined errors
const safeProfile = computed(() => dashboardStore.profile ?? {});

// ── File Pickers ──
const cursorPicker = ref<QFile | null>(null);
const musicPicker = ref<QFile | null>(null);

const triggerCursorUpload = () => cursorPicker.value?.pickFiles();
const triggerMusicUpload = () => musicPicker.value?.pickFiles();

// ── Title Glitch ──
const titleGlitch = computed({
  get: () => safeProfile.value.titleGlitch ?? false,
  set: (value) => dashboardStore.updateField('titleGlitch', value),
});

const titleGlitchSpeed = computed({
  get: () => safeProfile.value.titleGlitchSpeed ?? 1.0,
  set: (value) => dashboardStore.updateField('titleGlitchSpeed', value),
});

const titleGlitchSpeedLabel = computed(() => {
  const m = titleGlitchSpeed.value ?? 1.0;
  if (m <= 0.75) return 'slow';
  if (m >= 2 && m < 3) return 'fast';
  if (m >= 3 && m < 3.5) return 'very fast';
  if (m >= 3.5) return 'shiiii aightt';
  return 'normal';
});

// ── File upload state ──
const cursorFile = ref<File | null>(null);
const musicFile = ref<File | null>(null);

const cursorUploadStatus = ref('');
const musicUploadStatus = ref('');

// ── Cursor validation ──
const cursorValidationError = ref('');
const cursorSizeHint = ref('checking size…');

/** Properly formatted CSS cursor value with auto fallback, resized to 32x32 */
const cursorCssValue = computed(() => {
  const url = customCursor.value;
  if (!url) return 'auto';
  // Use 32x32 as cursor size - browsers will resize the image to this size
  return `url('${url}') 0 0, auto`;
});

function onCursorImageLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  cursorValidationError.value = '';
  if (img.naturalWidth > 128 || img.naturalHeight > 128) {
    cursorValidationError.value = `image is ${img.naturalWidth}×${img.naturalHeight}px — recommend 32×32px for best browser support`;
    cursorSizeHint.value = `${img.naturalWidth}×${img.naturalHeight}px (oversized)`;
  } else if (img.naturalWidth !== 32 || img.naturalHeight !== 32) {
    cursorSizeHint.value = `${img.naturalWidth}×${img.naturalHeight}px (32×32 recommended)`;
  } else {
    cursorSizeHint.value = '32×32px ✓';
  }
}

// ── Title Glitch preview animation ──
const titleGlitchPreview = ref('█');
let glitchInterval: ReturnType<typeof setInterval> | null = null;
const glitchChars = [
  '▀',
  '▁',
  '▂',
  '▃',
  '▄',
  '▅',
  '▆',
  '▇',
  '█',
  '▉',
  '▊',
  '▋',
  '▌',
  '▍',
  '▎',
  '▏',
  '▐',
  '░',
  '▒',
  '▓',
  '▔',
  '▕',
  '▖',
  '▗',
  '▘',
  '▙',
  '▚',
  '▛',
  '▜',
  '▝',
  '▞',
  '▟',
];

function startGlitchPreview() {
  stopGlitchPreview();
  const title = safeProfile.value.displayName || dashboardStore.username || '@ mourn';
  const speed = titleGlitchSpeed.value ?? 1.0;
  const baseDelay = 120;
  const delay = Math.round(baseDelay / speed);
  let counter = 0;
  let direction = true;
  let currentGlitchCount = 0;
  const maxGlitchCycles = 6;
  let pauseCounter = 0;
  const pauseDuration = 15;
  let isPaused = false;

  glitchInterval = setInterval(() => {
    let animatedPart = '';
    if (isPaused) {
      pauseCounter++;
      if (pauseCounter >= pauseDuration) {
        isPaused = false;
        pauseCounter = 0;
        direction = false;
      }
      animatedPart = title;
    } else if (direction) {
      if (counter < title.length) {
        for (let i = 0; i < counter; i++) animatedPart += title[i];
        if (currentGlitchCount < maxGlitchCycles) {
          animatedPart += glitchChars[Math.floor(Math.random() * glitchChars.length)];
          currentGlitchCount++;
        } else {
          animatedPart += title[counter];
          counter++;
          currentGlitchCount = 0;
        }
      } else {
        isPaused = true;
        animatedPart = title;
      }
    } else {
      if (counter > 0) {
        counter--;
        animatedPart = title.slice(0, counter);
        if (counter === 0) {
          animatedPart = glitchChars[Math.floor(Math.random() * glitchChars.length)] ?? '█';
        }
      } else {
        direction = true;
        currentGlitchCount = 0;
        animatedPart = glitchChars[Math.floor(Math.random() * glitchChars.length)] ?? '█';
      }
    }
    titleGlitchPreview.value = animatedPart || '█';
  }, delay);
}

function stopGlitchPreview() {
  if (glitchInterval) {
    clearInterval(glitchInterval);
    glitchInterval = null;
  }
  titleGlitchPreview.value = '█';
}

const audioPreviewRef = ref<HTMLAudioElement | null>(null);

watch(
  () => safeProfile.value.musicVolume,
  (vol) => {
    if (audioPreviewRef.value) audioPreviewRef.value.volume = vol ?? 0.5;
  },
);

watch(audioPreviewRef, (el) => {
  if (el) el.volume = safeProfile.value.musicVolume ?? 0.5;
});

watch(
  () => safeProfile.value.titleGlitch ?? false,
  (enabled) => {
    if (enabled) void nextTick(() => startGlitchPreview());
    else stopGlitchPreview();
  },
  { immediate: true },
);

watch(
  () => titleGlitchSpeed.value,
  () => {
    if (safeProfile.value.titleGlitch ?? false) startGlitchPreview();
  },
);

onBeforeUnmount(() => stopGlitchPreview());

// ── Computed Fields ──
const entranceOverlayEnabled = computed({
  get: () => safeProfile.value.showEntranceOverlay ?? false,
  set: (value) => dashboardStore.updateField('showEntranceOverlay', value),
});

const entranceText = computed({
  get: () => safeProfile.value.entranceText || 'click to enter',
  set: (value) => dashboardStore.updateField('entranceText', value || 'click to enter'),
});

const entranceTextColor = computed({
  get: () => safeProfile.value.entranceTextColor || '#ffffff',
  set: (value) => dashboardStore.updateField('entranceTextColor', value),
});

const entranceTextFont = computed({
  get: () => safeProfile.value.entranceTextFont || 'Sour Gummy',
  set: (value) => dashboardStore.updateField('entranceTextFont', value || 'Sour Gummy'),
});

const entranceOverlayColor = computed({
  get: () => safeProfile.value.entranceOverlayColor || '#000000',
  set: (value) => dashboardStore.updateField('entranceOverlayColor', value),
});

const entranceOverlayOpacity = computed({
  get: () => safeProfile.value.entranceOverlayOpacity ?? 0.9,
  // Clamp to a sane 0..1 range (mirrors backend sanitizeOpacity)
  set: (value) =>
    dashboardStore.updateField('entranceOverlayOpacity', Math.min(1, Math.max(0, value))),
});

const profileAnimation = computed({
  get: () => safeProfile.value.profileAnimation || 'none',
  set: (value) => dashboardStore.updateField('profileAnimation', value),
});

const usernameEffects = computed({
  get: () => safeProfile.value.usernameEffects || '',
  set: (value) => dashboardStore.updateField('usernameEffects', value || null),
});

const descriptionAnimation = computed({
  get: () => safeProfile.value.descriptionAnimation || 'none',
  set: (value) => dashboardStore.updateField('descriptionAnimation', value),
});

const usernameGlowColor = computed({
  get: () => safeProfile.value.usernameGlowColor || '#ffffff',
  set: (value) => dashboardStore.updateField('usernameGlowColor', value || null),
});

const showUsernameGlowPicker = computed(() => {
  // Only show the glow-color picker when user selected glow OR any shimmer effect
  const effect = usernameEffects.value || '';
  return effect === 'glow' || ['shimmer-spin', 'shimmer-wave', 'shimmer-throb'].includes(effect);
});

const customCursor = computed({
  get: () => safeProfile.value.customCursor || '',
  set: (value) => {
    cursorValidationError.value = '';
    cursorSizeHint.value = 'checking size…';
    dashboardStore.updateField('customCursor', value || null);
  },
});

const cursorEffect = computed({
  get: () => safeProfile.value.cursorEffect || '',
  set: (value) => dashboardStore.updateField('cursorEffect', value || null),
});

// Cursor size (px), capped 8–96 to match the sanitizer's bounds.
const cursorSize = computed({
  get: () => {
    const size = safeProfile.value.cursorSize ?? 32;
    return Math.min(96, Math.max(8, size));
  },
  set: (value) => dashboardStore.updateField('cursorSize', Math.min(96, Math.max(8, value))),
});

const musicEnabled = computed({
  get: () => safeProfile.value.musicEnabled ?? false,
  set: (value) => dashboardStore.updateField('musicEnabled', value),
});

const musicUrl = computed({
  get: () => safeProfile.value.musicUrl || '',
  set: (value) => dashboardStore.updateField('musicUrl', value || null),
});

const musicVolume = computed({
  get: () => safeProfile.value.musicVolume ?? 0.5,
  set: (value) => dashboardStore.updateField('musicVolume', value),
});

const musicAutoplay = computed({
  get: () => safeProfile.value.musicAutoplay ?? false,
  set: (value) => dashboardStore.updateField('musicAutoplay', value),
});

const musicLoop = computed({
  get: () => safeProfile.value.musicLoop ?? false,
  set: (value) => dashboardStore.updateField('musicLoop', value),
});

const seoTitle = computed({
  get: () => safeProfile.value.seoTitle || '',
  set: (value) => dashboardStore.updateField('seoTitle', value || null),
});

const seoDescription = computed({
  get: () => safeProfile.value.seoDescription || '',
  set: (value) => dashboardStore.updateField('seoDescription', value || null),
});

// ── File upload handlers ──
async function handleCursorUpload(file: File | null) {
  if (!file) return;
  cursorUploadStatus.value = 'Uploading...';
  const url = await dashboardStore.uploadFile(file, 'customCursor');
  if (url) {
    customCursor.value = url;
    cursorUploadStatus.value = 'Upload complete!';
  } else {
    cursorUploadStatus.value = dashboardStore.error || 'Upload failed';
  }
  cursorFile.value = null;
  setTimeout(() => {
    cursorUploadStatus.value = '';
  }, 3000);
}

async function handleMusicUpload(file: File | null) {
  if (!file) return;
  musicUploadStatus.value = 'Uploading...';
  const url = await dashboardStore.uploadFile(file, 'musicUrl');
  if (url) {
    musicUrl.value = url;
    musicUploadStatus.value = 'Upload complete!';
  } else {
    musicUploadStatus.value = dashboardStore.error || 'Upload failed';
  }
  musicFile.value = null;
  setTimeout(() => {
    musicUploadStatus.value = '';
  }, 3000);
}
</script>

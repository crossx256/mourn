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
            appearance
          </h1>
        </div>
        <p class="text-muted text-xs m-0">customize colors, backgrounds, and typography</p>
      </div>
    </div>

    <!-- Background Section -->
    <q-card flat bordered dark class="dash-card mb-5" data-field="background">
      <q-card-section>
        <div class="dash-section-title">background</div>

        <!-- Background Preview -->
        <div
          class="bg-preview mb-4 h-32 bg-dash-card border border-solid border-dash-border rounded overflow-hidden flex items-center justify-center"
        >
          <img
            v-if="backgroundGif || backgroundImage"
            :src="backgroundGif || backgroundImage"
            class="w-full h-full object-cover"
          />
          <div v-else class="text-muted text-center">
            <q-icon name="mdi-image" size="32px" class="mb-2" />
            <div class="text-xs">no background set</div>
          </div>
        </div>
        <div class="flex gap-2 mb-4" data-field="background-image">
          <div class="flex-1">
            <div class="text-xs text-muted mb-1">background image</div>
            <q-input
              v-model="backgroundImage"
              hint="paste a URL or click the icon to upload"
              dark
              filled
              square
              dense
              class="dashboard-no-label-field"
            >
              <template #append>
                <q-icon
                  v-if="backgroundImage"
                  name="mdi-close"
                  class="cursor-pointer q-mr-xs text-dash-muted hover:text-white"
                  @click="backgroundImage = ''"
                />

                <q-icon
                  name="mdi-upload"
                  class="cursor-pointer text-primary"
                  @click="imagePicker?.pickFiles()"
                >
                  <q-tooltip>upload image</q-tooltip>
                </q-icon>
              </template>
            </q-input>
          </div>
        </div>
        <div v-if="bgImageStatus" class="text-xs text-muted mb-4">{{ bgImageStatus }}</div>

        <div class="flex gap-2 mb-4" data-field="background-gif">
          <div class="flex-1">
            <div class="text-xs text-muted mb-1">animated background</div>
            <q-input
              v-model="backgroundGif"
              hint="GIF or video URL"
              dark
              filled
              square
              dense
              class="dashboard-no-label-field"
            >
              <template #append>
                <q-icon
                  v-if="backgroundGif"
                  name="mdi-close"
                  class="cursor-pointer q-mr-xs text-dash-muted hover:text-white"
                  @click="backgroundGif = ''"
                />

                <q-icon
                  name="mdi-upload"
                  class="cursor-pointer text-primary"
                  @click="gifPicker?.pickFiles()"
                >
                  <q-tooltip>upload animation</q-tooltip>
                </q-icon>
              </template>
            </q-input>
          </div>
        </div>
        <div v-if="bgGifStatus" class="text-xs text-muted mb-4">{{ bgGifStatus }}</div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <div data-field="background-opacity">
            <div class="text-xs text-muted mb-2">opacity: {{ backgroundOpacity }}</div>
            <q-slider
              v-model="backgroundOpacity"
              :min="0"
              :max="1"
              :step="0.01"
              dark
              color="primary"
              label
              thumb-size="12px"
              track-size="4px"
            />
          </div>
          <div data-field="background-blur">
            <div class="text-xs text-muted mb-2">blur: {{ backgroundBlur }}px</div>
            <q-slider
              v-model="backgroundBlur"
              :min="0"
              :max="20"
              :step="0.5"
              dark
              color="primary"
              label
              :label-value="backgroundBlur + 'px'"
              thumb-size="12px"
              track-size="4px"
            />
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-xs text-muted">fallback color:</span>
          <q-input
            v-model="backgroundColor"
            dark
            filled
            square
            dense
            class="w-40 dashboard-no-label-field"
          >
            <template #prepend>
              <q-icon name="mdi-palette" :style="{ color: backgroundColor }" />
            </template>
            <template #append>
              <q-icon name="mdi-eyedropper" class="cursor-pointer">
                <q-popup-proxy>
                  <q-color v-model="backgroundColor" dark />
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>
        </div>
      </q-card-section>
    </q-card>

    <!-- Username Style Section -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">username style</div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-muted">color</span>
            <q-input
              v-model="usernameTextColor"
              dark
              filled
              square
              dense
              class="w-full dashboard-no-label-field"
            >
              <template #prepend>
                <div
                  class="w-4 h-4 rounded-sm"
                  :style="{ background: usernameTextColor ?? '#ffffff' }"
                ></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy>
                    <q-color v-model="usernameTextColor" dark />
                  </q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div class="flex flex-col gap-1">
            <div class="text-xs text-muted">size</div>
            <q-input
              v-model.number="usernameFontSize"
              type="number"
              :min="12"
              :max="72"
              dark
              filled
              square
              dense
              class="w-full dashboard-no-label-field"
            />
          </div>

          <div class="flex flex-col gap-1">
            <div class="text-xs text-muted">weight</div>
            <q-select
              v-model="usernameFontWeight"
              :options="fontWeightOptions"
              dark
              filled
              square
              dense
              emit-value
              map-options
              class="w-full dashboard-no-label-field"
            />
          </div>
        </div>

        <q-expansion-item dark dense>
          <template #header>
            <div class="px-2 flex items-center gap-2 text-muted text-xs w-full">
              <span>advanced options</span>
            </div>
          </template>
          <q-card dark class="bg-transparent">
            <q-card-section class="pt-2">
              <label class="toggle-item compact mb-2">
                <input type="checkbox" v-model="usernameEnableShadow" />
                <div class="toggle-switch"></div>
                <div class="toggle-info">
                  <span class="toggle-label">text shadow</span>
                  <span class="toggle-desc"></span>
                </div>
              </label>

              <div v-if="usernameEnableShadow" class="grid grid-cols-4 gap-2 mb-4">
                <div class="flex flex-col gap-1">
                  <div class="text-xs text-muted">color</div>
                  <q-input
                    v-model="usernameTextShadowColor"
                    dark
                    filled
                    square
                    dense
                    class="dashboard-no-label-field"
                  >
                    <template #append>
                      <q-icon name="mdi-eyedropper" class="cursor-pointer">
                        <q-popup-proxy>
                          <q-color v-model="usernameTextShadowColor" dark />
                        </q-popup-proxy>
                      </q-icon>
                    </template>
                  </q-input>
                </div>
                <div class="flex flex-col gap-1">
                  <div class="text-xs text-muted">X</div>
                  <q-input
                    v-model.number="usernameTextShadowX"
                    type="number"
                    dark
                    filled
                    square
                    dense
                    class="dashboard-no-label-field"
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <div class="text-xs text-muted">Y</div>
                  <q-input
                    v-model.number="usernameTextShadowY"
                    type="number"
                    dark
                    filled
                    square
                    dense
                    class="dashboard-no-label-field"
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <div class="text-xs text-muted">blur</div>
                  <q-input
                    v-model.number="usernameTextShadowBlur"
                    type="number"
                    dark
                    filled
                    square
                    dense
                    class="dashboard-no-label-field"
                  />
                </div>
              </div>

              <q-input
                v-model="usernameLetterSpacing"
                placeholder="normal, 2px, 0.1em"
                dark
                filled
                square
                dense
                class="mb-2 dashboard-no-label-field"
              />

              <q-input
                v-model="usernameTextStroke"
                placeholder="2px #000000"
                dark
                filled
                square
                dense
                class="dashboard-no-label-field"
              />
            </q-card-section>
          </q-card>
        </q-expansion-item>
      </q-card-section>
    </q-card>

    <!-- Bio Style Section -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">bio style</div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-muted">color</span>
            <q-input
              v-model="bioTextColor"
              dark
              filled
              square
              dense
              class="w-full dashboard-no-label-field"
            >
              <template #prepend>
                <div
                  class="w-4 h-4 rounded-sm"
                  :style="{ background: bioTextColor ?? '#ffffff' }"
                ></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy>
                    <q-color v-model="bioTextColor" dark />
                  </q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div class="flex flex-col gap-1">
            <div class="text-xs text-muted">size</div>
            <q-input
              v-model.number="bioFontSize"
              type="number"
              :min="10"
              :max="32"
              dark
              filled
              square
              dense
              class="w-full dashboard-no-label-field"
            />
          </div>

          <div class="flex flex-col gap-1">
            <div class="text-xs text-muted">weight</div>
            <q-select
              v-model="bioFontWeight"
              :options="fontWeightOptions"
              dark
              filled
              square
              dense
              emit-value
              map-options
              class="w-full dashboard-no-label-field"
            />
          </div>
        </div>

        <q-expansion-item dark dense>
          <template #header>
            <div class="px-2 flex items-center gap-2 text-muted text-xs w-full">
              <span>advanced options</span>
            </div>
          </template>
          <q-card dark class="bg-transparent">
            <q-card-section class="pt-2">
              <label class="toggle-item compact mb-2">
                <input type="checkbox" v-model="bioEnableShadow" />
                <div class="toggle-switch"></div>
                <div class="toggle-info">
                  <span class="toggle-label">text shadow</span>
                  <span class="toggle-desc"></span>
                </div>
              </label>

              <div v-if="bioEnableShadow" class="grid grid-cols-4 gap-2 mb-4">
                <div class="flex flex-col gap-1">
                  <div class="text-xs text-muted">color</div>
                  <q-input
                    v-model="bioTextShadowColor"
                    dark
                    filled
                    square
                    dense
                    class="dashboard-no-label-field"
                  >
                    <template #append>
                      <q-icon name="mdi-eyedropper" class="cursor-pointer">
                        <q-popup-proxy>
                          <q-color v-model="bioTextShadowColor" dark />
                        </q-popup-proxy>
                      </q-icon>
                    </template>
                  </q-input>
                </div>
                <div class="flex flex-col gap-1">
                  <div class="text-xs text-muted">X</div>
                  <q-input
                    v-model.number="bioTextShadowX"
                    type="number"
                    dark
                    filled
                    square
                    dense
                    class="dashboard-no-label-field"
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <div class="text-xs text-muted">Y</div>
                  <q-input
                    v-model.number="bioTextShadowY"
                    type="number"
                    dark
                    filled
                    square
                    dense
                    class="dashboard-no-label-field"
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <div class="text-xs text-muted">blur</div>
                  <q-input
                    v-model.number="bioTextShadowBlur"
                    type="number"
                    dark
                    filled
                    square
                    dense
                    class="dashboard-no-label-field"
                  />
                </div>
              </div>

              <div class="mb-4">
                <div class="text-xs text-muted mb-2">
                  line height: {{ (bioLineHeight ?? 1.5).toFixed(2) }}
                </div>
                <q-slider
                  v-model="bioLineHeight"
                  :min="1"
                  :max="3"
                  :step="0.1"
                  dark
                  color="primary"
                  label
                  thumb-size="12px"
                  track-size="4px"
                />
              </div>

              <q-input
                v-model="bioLetterSpacing"
                placeholder="normal, 1px, 0.05em"
                dark
                filled
                square
                dense
                class="dashboard-no-label-field"
              />
            </q-card-section>
          </q-card>
        </q-expansion-item>
      </q-card-section>
    </q-card>
    <!-- Icons & Badges Section -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">icons & badges</div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div class="text-xs text-muted mb-2">icon size: {{ socialIconSize }}px</div>
            <q-slider
              v-model="socialIconSize"
              :min="30"
              :max="100"
              dark
              color="primary"
              label
              :label-value="socialIconSize + 'px'"
              thumb-size="12px"
              track-size="4px"
            />
          </div>
          <div>
            <div class="text-xs text-muted mb-2">badge size: {{ badgeSize }}px</div>
            <q-slider
              v-model="badgeSize"
              :min="30"
              :max="100"
              dark
              color="primary"
              label
              :label-value="badgeSize + 'px'"
              thumb-size="12px"
              track-size="4px"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-muted">icon color</span>
            <q-input
              v-model="socialIconColor"
              dark
              filled
              square
              dense
              class="w-full dashboard-no-label-field"
            >
              <template #prepend>
                <div class="w-4 h-4 rounded-sm" :style="{ background: socialIconColor }"></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy><q-color v-model="socialIconColor" dark /></q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-xs text-muted">badge color</span>
            <q-input
              v-model="badgeColor"
              dark
              filled
              square
              dense
              class="w-full dashboard-no-label-field"
            >
              <template #prepend>
                <div class="w-4 h-4 rounded-sm" :style="{ background: badgeColor }"></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy><q-color v-model="badgeColor" dark /></q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div class="flex flex-col gap-1">
            <div class="text-xs text-muted">hover effect</div>
            <q-select
              v-model="socialIconHoverEffect"
              :options="hoverEffectOptions"
              dark
              filled
              square
              dense
              emit-value
              map-options
              class="w-full dashboard-no-label-field"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Custom Font Section -->
    <q-card flat bordered class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">custom font</div>

        <q-input
          v-model="customFont"
          placeholder="https://fonts.googleapis.com/css2?family=... or Poppins"
          dark
          filled
          square
          debounce="300"
          :error="!!fontValidationError"
          :error-message="fontValidationError"
          class="dashboard-no-label-field"
        />
        <p class="text-[10px] text-muted mt-1 mb-3">
          paste a full Google Fonts URL (must start with
          <code class="text-primary">https://fonts.googleapis.com/</code>) or just the font name
        </p>

        <!-- Uploaded font (.ttf from your computer) -->
        <div class="flex items-center gap-2 mb-2">
          <q-btn
            flat
            unelevated
            dense
            icon="mdi-upload"
            label="upload .ttf / .otf font"
            color="primary"
            size="sm"
            @click="triggerFontUpload"
          />
          <q-btn
            v-if="customFontUrl"
            flat
            unelevated
            dense
            icon="mdi-delete-outline"
            label="remove uploaded font"
            color="negative"
            size="sm"
            @click="removeUploadedFont"
          />
        </div>
        <div v-if="fontUploadStatus" class="text-xs text-primary mb-2 animate-pulse">
          <i class="mdi mdi-loading mdi-spin mr-1"></i> {{ fontUploadStatus }}
        </div>
        <div
          v-if="uploadedFontActive"
          class="p-3 bg-[#0a0a0a] border border-solid border-[#1a1a1a] rounded"
          :style="{ fontFamily: UPLOADED_FONT_FAMILY_STR }"
        >
          <span class="text-primary text-sm">The quick brown fox jumps over the lazy dog</span>
          <div class="text-[10px] text-muted mt-1">uploaded font active</div>
        </div>

        <!-- Font Preview -->
        <div
          v-if="!uploadedFontActive && resolvedFontFamily"
          class="p-3 bg-[#0a0a0a] border border-solid border-[#1a1a1a] rounded"
          :style="{ fontFamily: resolvedFontFamily + ', sans-serif' }"
        >
          <span class="text-primary text-sm">The quick brown fox jumps over the lazy dog</span>
          <div class="text-[10px] text-muted mt-1">font: {{ resolvedFontFamily }}</div>
        </div>
      </q-card-section>
    </q-card>
    <q-file
      ref="fontPicker"
      v-model="fontFile"
      accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
      class="hidden"
      @update:model-value="handleFontUpload"
    />
    <q-file
      ref="imagePicker"
      v-model="bgImageFile"
      accept="image/*"
      class="hidden"
      @update:model-value="handleBackgroundImageUpload"
    />

    <q-file
      ref="gifPicker"
      v-model="bgGifFile"
      accept="image/gif,video/mp4,video/webm"
      class="hidden"
      @update:model-value="handleBackgroundGifUpload"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useDashboardStore } from 'src/stores/dashboard';
import type { QFile } from 'quasar';
import {
  extractGoogleFontFamily,
  isGoogleFontsInput,
  applyUploadedFont,
  UPLOADED_FONT_FAMILY,
} from 'src/utils/googleFonts';

const $q = useQuasar();
const dashboardStore = useDashboardStore();

// All template refs should be together at the top
const imagePicker = ref<QFile | null>(null);
const gifPicker = ref<QFile | null>(null);
const fontPicker = ref<QFile | null>(null);
// File upload state
const bgImageFile = ref<File | null>(null);
const bgGifFile = ref<File | null>(null);
const fontFile = ref<File | null>(null);
const bgImageStatus = ref('');
const bgGifStatus = ref('');
const fontUploadStatus = ref('');

// Options
const fontWeightOptions = [
  { label: 'light', value: 300 },
  { label: 'normal', value: 400 },
  { label: 'medium', value: 500 },
  { label: 'semi-bold', value: 600 },
  { label: 'bold', value: 700 },
];

const hoverEffectOptions = [
  { label: 'none', value: 'static' },
  { label: 'bounce', value: 'bounce' },
  { label: 'glow', value: 'glow' },
  { label: 'scale', value: 'scale' },
];

// Background computed properties
const backgroundImage = computed({
  get: () => dashboardStore.profile.backgroundImage || '',
  set: (value) => dashboardStore.updateField('backgroundImage', value || null),
});

const backgroundGif = computed({
  get: () => dashboardStore.profile.backgroundGif || '',
  set: (value) => dashboardStore.updateField('backgroundGif', value || null),
});

const backgroundOpacity = computed({
  get: () => dashboardStore.profile.backgroundOpacity,
  set: (value) => dashboardStore.updateField('backgroundOpacity', value),
});

const backgroundBlur = computed({
  get: () => dashboardStore.profile.backgroundBlur,
  set: (value) => dashboardStore.updateField('backgroundBlur', value),
});

const backgroundColor = computed({
  get: () => dashboardStore.profile.backgroundColor,
  set: (value) => dashboardStore.updateField('backgroundColor', value),
});

// Username style computed properties
const usernameTextColor = computed({
  get: () => dashboardStore.profile.usernameTextColor,
  set: (value) => dashboardStore.updateField('usernameTextColor', value),
});

const usernameFontSize = computed({
  get: () => dashboardStore.profile.usernameFontSize,
  set: (value) => dashboardStore.updateField('usernameFontSize', value),
});

const usernameFontWeight = computed({
  get: () => dashboardStore.profile.usernameFontWeight,
  set: (value) => dashboardStore.updateField('usernameFontWeight', value),
});

const usernameLetterSpacing = computed({
  get: () => dashboardStore.profile.usernameLetterSpacing,
  set: (value) => dashboardStore.updateField('usernameLetterSpacing', value),
});

const usernameEnableShadow = computed({
  get: () => dashboardStore.profile.usernameEnableShadow,
  set: (value) => dashboardStore.updateField('usernameEnableShadow', value),
});

const usernameTextShadowColor = computed({
  get: () => dashboardStore.profile.usernameTextShadowColor,
  set: (value) => dashboardStore.updateField('usernameTextShadowColor', value),
});

const usernameTextShadowX = computed({
  get: () => dashboardStore.profile.usernameTextShadowX,
  set: (value) => dashboardStore.updateField('usernameTextShadowX', value),
});

const usernameTextShadowY = computed({
  get: () => dashboardStore.profile.usernameTextShadowY,
  set: (value) => dashboardStore.updateField('usernameTextShadowY', value),
});

const usernameTextShadowBlur = computed({
  get: () => dashboardStore.profile.usernameTextShadowBlur,
  set: (value) => dashboardStore.updateField('usernameTextShadowBlur', value),
});

const usernameTextStroke = computed({
  get: () => dashboardStore.profile.usernameTextStroke || '',
  set: (value) => dashboardStore.updateField('usernameTextStroke', value || null),
});

// Bio style computed properties
const bioTextColor = computed({
  get: () => dashboardStore.profile.bioTextColor,
  set: (value) => dashboardStore.updateField('bioTextColor', value),
});

const bioFontSize = computed({
  get: () => dashboardStore.profile.bioFontSize,
  set: (value) => dashboardStore.updateField('bioFontSize', value),
});

const bioFontWeight = computed({
  get: () => dashboardStore.profile.bioFontWeight,
  set: (value) => dashboardStore.updateField('bioFontWeight', value),
});

const bioLetterSpacing = computed({
  get: () => dashboardStore.profile.bioLetterSpacing,
  set: (value) => dashboardStore.updateField('bioLetterSpacing', value),
});

const bioLineHeight = computed({
  get: () => dashboardStore.profile.bioLineHeight,
  set: (value) => dashboardStore.updateField('bioLineHeight', value),
});

const bioEnableShadow = computed({
  get: () => dashboardStore.profile.bioEnableShadow,
  set: (value) => dashboardStore.updateField('bioEnableShadow', value),
});

const bioTextShadowColor = computed({
  get: () => dashboardStore.profile.bioTextShadowColor,
  set: (value) => dashboardStore.updateField('bioTextShadowColor', value),
});

const bioTextShadowX = computed({
  get: () => dashboardStore.profile.bioTextShadowX,
  set: (value) => dashboardStore.updateField('bioTextShadowX', value),
});

const bioTextShadowY = computed({
  get: () => dashboardStore.profile.bioTextShadowY,
  set: (value) => dashboardStore.updateField('bioTextShadowY', value),
});

const bioTextShadowBlur = computed({
  get: () => dashboardStore.profile.bioTextShadowBlur,
  set: (value) => dashboardStore.updateField('bioTextShadowBlur', value),
});

// Icons & Badges
const socialIconSize = computed({
  get: () => dashboardStore.profile.socialIconSize,
  set: (value) => dashboardStore.updateField('socialIconSize', value),
});

const badgeSize = computed({
  get: () => dashboardStore.profile.badgeSize,
  set: (value) => dashboardStore.updateField('badgeSize', value),
});

const socialIconColor = computed({
  get: () => dashboardStore.profile.socialIconColor || '#ffffff',
  set: (value) => dashboardStore.updateField('socialIconColor', value),
});

const badgeColor = computed({
  get: () => dashboardStore.profile.badgeColor || '#cccccc',
  set: (value) => dashboardStore.updateField('badgeColor', value),
});

const socialIconHoverEffect = computed({
  get: () => dashboardStore.profile.socialIconHoverEffect,
  set: (value) => dashboardStore.updateField('socialIconHoverEffect', value),
});

// ── Google Fonts custom font with URL validation & injection ──
const fontValidationError = ref('');

const customFont = computed({
  get: () => dashboardStore.profile.customFont || '',
  set: (value) => {
    fontValidationError.value = '';
    const trimmed = (value || '').trim();

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      if (!isGoogleFontsInput(trimmed)) {
        fontValidationError.value = 'URL must be a Google Fonts CSS or specimen URL';
        return; // reject — don't write to store
      }
    }

    dashboardStore.updateField('customFont', trimmed || null);
  },
});

/** Resolved font-family name for CSS preview */
const resolvedFontFamily = computed(() => {
  const val = customFont.value;
  if (!val) return '';
  return extractGoogleFontFamily(val) || '';
});

// ── Uploaded font (.ttf / .otf) ──
const customFontUrl = computed({
  get: () => dashboardStore.profile.customFontUrl || '',
  set: (value) => dashboardStore.updateField('customFontUrl', value || null),
});

const uploadedFontActive = computed(() =>
  Boolean(customFontUrl.value && customFontUrl.value.trim()),
);

const UPLOADED_FONT_FAMILY_STR = `'${UPLOADED_FONT_FAMILY}', sans-serif`;

const triggerFontUpload = () => fontPicker.value?.pickFiles();

async function handleFontUpload(file: File | null) {
  if (!file) return;
  fontUploadStatus.value = 'Uploading font...';
  const url = await dashboardStore.uploadFile(file, 'customFontUrl');
  if (url) {
    customFontUrl.value = url;
    // Inject @font-face immediately so the preview uses the new font.
    applyUploadedFont(url);
    fontUploadStatus.value = 'Font uploaded!';
  } else {
    fontUploadStatus.value = dashboardStore.error || 'Upload failed';
  }
  fontFile.value = null;
  setTimeout(() => {
    fontUploadStatus.value = '';
  }, 3000);
}

function removeUploadedFont() {
  customFontUrl.value = '';
  applyUploadedFont(null);
}

// File upload handlers
async function handleBackgroundImageUpload(file: File | null) {
  if (!file) return;
  bgImageStatus.value = 'Uploading...';
  const url = await dashboardStore.uploadFile(file, 'backgroundImage');
  if (url) {
    backgroundImage.value = url;
    bgImageStatus.value = 'Upload complete!';
  } else {
    bgImageStatus.value = dashboardStore.error || 'Upload failed';
  }
  bgImageFile.value = null;
  setTimeout(() => {
    bgImageStatus.value = '';
  }, 3000);
}

async function handleBackgroundGifUpload(file: File | null) {
  if (!file) return;
  bgGifStatus.value = 'Uploading...';
  const url = await dashboardStore.uploadFile(file, 'backgroundGif');
  if (url) {
    backgroundGif.value = url;
    bgGifStatus.value = 'Upload complete!';
  } else {
    bgGifStatus.value = dashboardStore.error || 'Upload failed';
  }
  bgGifFile.value = null;
  setTimeout(() => {
    bgGifStatus.value = '';
  }, 3000);
}
</script>

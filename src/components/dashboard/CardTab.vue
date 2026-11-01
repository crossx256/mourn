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
            card
          </h1>
        </div>
        <p class="text-muted text-xs m-0">customize the profile card container</p>
      </div>
    </div>

    <!-- Card Visibility Section -->
    <q-card flat bordered dark class="dash-card mb-5" data-field="card-visibility">
      <q-card-section>
        <div class="dash-section-title">visibility</div>

        <div class="grid grid-cols-2 gap-4">
          <label class="toggle-item">
            <input type="checkbox" v-model="showProfileCard" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show profile card</span>
              <span class="toggle-desc">display the card container around your content</span>
            </div>
          </label>
          <label class="toggle-item">
            <input type="checkbox" v-model="enableTiltEffect" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">3D tilt effect</span>
              <span class="toggle-desc">card responds to mouse movement</span>
            </div>
          </label>
          <label class="toggle-item">
            <input type="checkbox" v-model="showCard" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show card background</span>
              <span class="toggle-desc"></span>
            </div>
          </label>
          <label class="toggle-item">
            <input type="checkbox" v-model="showCardBorders" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">show card borders</span>
              <span class="toggle-desc"></span>
            </div>
          </label>
        </div>
      </q-card-section>
    </q-card>

    <!-- Card Background Section -->
    <q-card v-if="showCard" flat bordered class="dash-card mb-5" data-field="card-background">
      <q-card-section>
        <div class="dash-section-title">card background</div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">bg color:</span>
            <q-input v-model="cardBackgroundColor" dark filled square dense class="flex-1">
              <template #prepend>
                <div class="w-4 h-4 rounded-sm" :style="{ background: cardBackgroundColor }"></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy><q-color v-model="cardBackgroundColor" dark /></q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div>
            <div class="text-xs text-muted mb-2">opacity: {{ cardOpacity }}</div>
            <q-slider
              v-model="cardOpacity"
              :min="0"
              :max="1"
              :step="0.01"
              dark
              color="primary"
              thumb-size="12px"
              track-size="4px"
            />
          </div>
        </div>

        <div>
          <div class="text-xs text-muted mb-2">blur: {{ cardBlur }}px</div>
          <q-slider
            v-model="cardBlur"
            :min="0"
            :max="30"
            :step="1"
            dark
            color="primary"
            :label-value="cardBlur + 'px'"
            thumb-size="12px"
            track-size="4px"
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- Card Borders Section -->
    <q-card v-if="showCardBorders" flat bordered class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">border style</div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">color:</span>
            <q-input v-model="cardBorderColor" dark filled square dense class="flex-1">
              <template #prepend>
                <div
                  class="w-4 h-4 rounded-sm"
                  :style="{ background: cardBorderColor ?? '#ffffff' }"
                ></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy><q-color v-model="cardBorderColor" dark /></q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">width:</span>
            <q-input
              v-model.number="cardBorderWidth"
              type="number"
              :min="0"
              :max="10"
              suffix="px"
              dark
              filled
              square
              dense
              class="flex-1"
            />
          </div>
        </div>

        <div class="mb-4">
          <div class="text-xs text-muted mb-2">border radius: {{ cardBorderRadius }}px</div>
          <q-slider
            v-model="cardBorderRadius"
            :min="0"
            :max="50"
            dark
            color="primary"
            :label-value="cardBorderRadius + 'px'"
            thumb-size="12px"
            track-size="4px"
          />
        </div>

        <div class="mb-4">
          <label class="text-xs text-muted mb-1 block"> border style </label>
          <select v-model="cardBorderStyle" class="mourn-select w-full">
            <option value="solid">solid</option>
            <option value="dashed">dashed</option>
            <option value="dotted">dotted</option>
            <option value="double">double</option>
            <option value="groove">groove</option>
            <option value="ridge">ridge</option>
            <option value="inset">inset</option>
            <option value="outset">outset</option>
            <option value="shimmer-spin">shimmer spin</option>
            <option value="shimmer-wave">shimmer wave</option>
            <option value="shimmer-throb">shimmer throb</option>
            <option value="gradient">gradient</option>
          </select>
        </div>

        <!-- Gradient CSS input (only for gradient border style) -->
        <q-input
          v-if="cardBorderStyle === 'gradient'"
          v-model="cardBorderGradient"
          placeholder="linear-gradient(45deg, #ff0000, #00ff00)"
          dark
          filled
          square
          dense
          class="mb-4 dashboard-no-label-field"
        />
      </q-card-section>
    </q-card>

    <!-- Card Shadow Section -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">card shadow</div>

        <label class="toggle-item compact mb-4">
          <input type="checkbox" v-model="cardShadowEnabled" />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">enable shadow</span>
            <span class="toggle-desc"></span>
          </div>
        </label>

        <div v-if="cardShadowEnabled" class="space-y-4">
          <div class="grid grid-cols-4 gap-3">
            <div class="flex items-center gap-2 col-span-1">
              <span class="text-xs text-muted">color:</span>
              <q-input v-model="cardShadowColor" dark filled square dense class="flex-1">
                <template #append>
                  <q-icon name="mdi-eyedropper" class="cursor-pointer">
                    <q-popup-proxy><q-color v-model="cardShadowColor" dark /></q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted">X offset:</span>
              <q-input
                v-model.number="cardShadowX"
                type="number"
                dark
                filled
                square
                dense
                class="flex-1"
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted">Y offset:</span>
              <q-input
                v-model.number="cardShadowY"
                type="number"
                dark
                filled
                square
                dense
                class="flex-1"
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted">blur:</span>
              <q-input
                v-model.number="cardShadowBlur"
                type="number"
                :min="0"
                dark
                filled
                square
                dense
                class="flex-1"
              />
            </div>
          </div>

          <div>
            <div class="text-xs text-muted mb-2">spread: {{ cardShadowSpread }}px</div>
            <q-slider
              v-model="cardShadowSpread"
              :min="-20"
              :max="50"
              dark
              color="primary"
              thumb-size="12px"
              track-size="4px"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Card Size & Position Section -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">size & position</div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <q-input
            v-model="cardWidth"
            placeholder="auto, 400px, 80%"
            dark
            filled
            square
            class="dashboard-no-label-field"
          />
          <q-input
            v-model="cardMaxWidth"
            placeholder="500px, 90vw"
            dark
            filled
            square
            class="dashboard-no-label-field"
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <q-input
            v-model="cardPadding"
            placeholder="20px, 2rem"
            dark
            filled
            square
            class="dashboard-no-label-field"
          />
          <q-input
            v-model="cardMargin"
            placeholder="0 auto, 20px"
            dark
            filled
            square
            class="dashboard-no-label-field"
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- Inner Element Borders Section -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">inner element borders</div>

        <label class="toggle-item compact mb-4">
          <input type="checkbox" v-model="showBorders" />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">show inner borders</span>
            <span class="toggle-desc">borders on stats, bio box, etc.</span>
          </div>
        </label>

        <div v-if="showBorders" class="space-y-4">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">color:</span>
            <q-input v-model="borderColor" dark filled square dense class="w-40">
              <template #prepend>
                <div class="w-4 h-4 rounded-sm" :style="{ background: borderColor }"></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy><q-color v-model="borderColor" dark /></q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div>
            <label class="text-xs text-muted mb-1 block">radius</label>
            <select v-model="borderRadius" class="mourn-select w-full">
              <option value="0px">sharp</option>
              <option value="8px">small (8px)</option>
              <option value="16px">medium (16px)</option>
            </select>
          </div>

          <div>
            <label class="text-xs text-muted mb-1 block"> style </label>
            <select v-model="borderStyle" class="mourn-select w-full">
              <option value="solid">solid</option>
              <option value="glow">glow</option>
              <option value="gradient">gradient</option>
            </select>
          </div>

          <q-input
            v-if="borderStyle === 'gradient'"
            v-model="borderGradient"
            placeholder="linear-gradient(45deg, #ff0000, #00ff00)"
            dark
            filled
            square
            dense
            class="dashboard-no-label-field"
          />

          <label class="toggle-item compact">
            <input type="checkbox" v-model="profilePictureBorder" />
            <div class="toggle-switch"></div>
            <div class="toggle-info">
              <span class="toggle-label">profile picture border</span>
              <span class="toggle-desc"></span>
            </div>
          </label>
        </div>
      </q-card-section>
    </q-card>

    <!-- Layout Section -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">layout</div>

        <div class="flex gap-4 mb-4">
          <label class="layout-option" v-for="opt in layoutOptions" :key="opt.value">
            <input type="radio" name="profile-layout" v-model="profileLayout" :value="opt.value" />
            <div class="layout-preview" :class="'layout-' + opt.value">
              <div class="layout-icon"></div>
              <div v-if="opt.value !== 'minimal'" class="layout-lines"></div>
            </div>
            <span class="text-[10px] text-muted">{{ opt.label }}</span>
          </label>
        </div>
      </q-card-section>
    </q-card>

    <!-- Stats Position -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">stats</div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-muted mb-1 block">position</label>
            <select v-model="statsPosition" class="mourn-select w-full">
              <option value="default">default</option>
              <option value="top">top</option>
              <option value="bottom">bottom</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-muted mb-1 block">size</label>
            <select v-model="statsSize" class="mourn-select w-full">
              <option value="normal">normal</option>
              <option value="small">small</option>
              <option value="large">large</option>
            </select>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Card Glow Effect -->
    <q-card flat bordered class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">glow effect</div>

        <label class="toggle-item compact mb-4">
          <input type="checkbox" v-model="cardGlowEnabled" />
          <div class="toggle-switch"></div>
          <div class="toggle-info">
            <span class="toggle-label">enable glow</span>
            <span class="toggle-desc"></span>
          </div>
        </label>

        <div v-if="cardGlowEnabled" class="grid grid-cols-2 gap-4">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">color:</span>
            <q-input v-model="cardGlowColor" dark filled square dense class="flex-1">
              <template #prepend>
                <div class="w-4 h-4 rounded-sm" :style="{ background: cardGlowColor }"></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy><q-color v-model="cardGlowColor" dark /></q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div>
            <div class="text-xs text-muted mb-2">intensity: {{ cardGlowIntensity }}px</div>
            <q-slider
              v-model="cardGlowIntensity"
              :min="0"
              :max="50"
              dark
              color="primary"
              thumb-size="12px"
              track-size="4px"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import { useDashboardStore } from 'src/stores/dashboard';

const $q = useQuasar();
const dashboardStore = useDashboardStore();
// Options
const layoutOptions = [
  { label: 'centered', value: 'default' },
  { label: 'split', value: 'split' },
  { label: 'minimal', value: 'minimal' },
];

// Visibility
const showCard = computed({
  get: () => dashboardStore.profile.showCard,
  set: (value) => dashboardStore.updateField('showCard', value),
});

const showCardBorders = computed({
  get: () => dashboardStore.profile.showCardBorders,
  set: (value) => dashboardStore.updateField('showCardBorders', value),
});

// Card Background

const cardBackgroundColor = computed({
  get: () => dashboardStore.profile.cardBackgroundColor,
  set: (value) => dashboardStore.updateField('cardBackgroundColor', value),
});

const cardOpacity = computed({
  get: () => dashboardStore.profile.cardOpacity,
  set: (value) => dashboardStore.updateField('cardOpacity', value),
});

const cardBlur = computed({
  get: () => dashboardStore.profile.cardBlur,
  set: (value) => dashboardStore.updateField('cardBlur', value),
});

// Card Borders
const cardBorderColor = computed({
  get: () => dashboardStore.profile.cardBorderColor,
  set: (value) => dashboardStore.updateField('cardBorderColor', value),
});

const cardBorderWidth = computed({
  get: () => dashboardStore.profile.cardBorderWidth,
  set: (value) => dashboardStore.updateField('cardBorderWidth', value),
});

const cardBorderRadius = computed({
  get: () => parseInt(dashboardStore.profile.cardBorderRadius ?? '0', 10),
  set: (value) => dashboardStore.updateField('cardBorderRadius', `${value}px`),
});

const cardBorderStyle = computed({
  get: () => dashboardStore.profile.cardBorderStyle,
  set: (value) => dashboardStore.updateField('cardBorderStyle', value),
});

// Card Shadow
const cardShadowEnabled = computed({
  get: () => dashboardStore.profile.cardShadowEnabled,
  set: (value) => dashboardStore.updateField('cardShadowEnabled', value),
});

const cardShadowColor = computed({
  get: () => dashboardStore.profile.cardShadowColor,
  set: (value) => dashboardStore.updateField('cardShadowColor', value),
});

const cardShadowX = computed({
  get: () => dashboardStore.profile.cardShadowX,
  set: (value) => dashboardStore.updateField('cardShadowX', value),
});

const cardShadowY = computed({
  get: () => dashboardStore.profile.cardShadowY,
  set: (value) => dashboardStore.updateField('cardShadowY', value),
});

const cardShadowBlur = computed({
  get: () => dashboardStore.profile.cardShadowBlur,
  set: (value) => dashboardStore.updateField('cardShadowBlur', value),
});

const cardShadowSpread = computed({
  get: () => dashboardStore.profile.cardShadowSpread,
  set: (value) => dashboardStore.updateField('cardShadowSpread', value),
});

// Card Size & Position
const cardWidth = computed({
  get: () => dashboardStore.profile.cardWidth || '',
  set: (value) => dashboardStore.updateField('cardWidth', value || null),
});

const cardMaxWidth = computed({
  get: () => dashboardStore.profile.cardMaxWidth || '',
  set: (value) => dashboardStore.updateField('cardMaxWidth', value || null),
});

const cardPadding = computed({
  get: () => dashboardStore.profile.cardPadding || '',
  set: (value) => dashboardStore.updateField('cardPadding', value || null),
});

const cardMargin = computed({
  get: () => dashboardStore.profile.cardMargin || '',
  set: (value) => dashboardStore.updateField('cardMargin', value || null),
});

// Card Glow
const cardGlowEnabled = computed({
  get: () => dashboardStore.profile.cardGlowEnabled,
  set: (value) => dashboardStore.updateField('cardGlowEnabled', value),
});

const cardGlowColor = computed({
  get: () => dashboardStore.profile.cardGlowColor || '#ff0000',
  set: (value) => dashboardStore.updateField('cardGlowColor', value),
});

const cardGlowIntensity = computed({
  get: () => dashboardStore.profile.cardGlowIntensity || 20,
  set: (value) => dashboardStore.updateField('cardGlowIntensity', value),
});

// Card Visibility extras
const showProfileCard = computed({
  get: () => dashboardStore.profile.showProfileCard,
  set: (value) => dashboardStore.updateField('showProfileCard', value),
});

const enableTiltEffect = computed({
  get: () => dashboardStore.profile.enableTiltEffect,
  set: (value) => dashboardStore.updateField('enableTiltEffect', value),
});

// Card border gradient
const cardBorderGradient = computed({
  get: () => dashboardStore.profile.cardBorderGradient || '',
  set: (value) => dashboardStore.updateField('cardBorderGradient', value || null),
});

// Inner element borders
const showBorders = computed({
  get: () => dashboardStore.profile.showBorders,
  set: (value) => dashboardStore.updateField('showBorders', value),
});

const borderColor = computed({
  get: () => dashboardStore.profile.borderColor,
  set: (value) => dashboardStore.updateField('borderColor', value),
});

const borderRadius = computed({
  get: () => dashboardStore.profile.borderRadius,
  set: (value) => dashboardStore.updateField('borderRadius', value),
});

const borderStyle = computed({
  get: () => dashboardStore.profile.borderStyle,
  set: (value) => dashboardStore.updateField('borderStyle', value),
});

const borderGradient = computed({
  get: () => dashboardStore.profile.borderGradient || '',
  set: (value) => dashboardStore.updateField('borderGradient', value || null),
});

const profilePictureBorder = computed({
  get: () => dashboardStore.profile.profilePictureBorder,
  set: (value) => dashboardStore.updateField('profilePictureBorder', value),
});

// Layout
const profileLayout = computed({
  get: () => dashboardStore.profile.profileLayout || 'default',
  set: (value) => dashboardStore.updateField('profileLayout', value),
});

// Stats
const statsPosition = computed({
  get: () => dashboardStore.profile.statsPosition || 'default',
  set: (value) => dashboardStore.updateField('statsPosition', value),
});

const statsSize = computed({
  get: () => dashboardStore.profile.statsSize || 'normal',
  set: (value) => dashboardStore.updateField('statsSize', value),
});
</script>

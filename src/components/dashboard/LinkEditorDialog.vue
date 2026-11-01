<template>
  <q-dialog
    :model-value="modelValue"
    :maximized="$q.screen.lt.md"
    @update:model-value="(open: boolean) => !open && close()"
  >
    <q-card
      dark
      class="link-editor"
      :style="$q.screen.lt.md ? '' : 'width: 470px; max-width: 94vw'"
    >
      <q-card-section class="link-editor-head">
        <div class="dash-section-title m-0">
          {{ isHeader ? 'edit section heading' : 'edit link' }}
        </div>
        <q-btn flat round dense icon="mdi-close" aria-label="close" @click="close" />
      </q-card-section>

      <q-card-section v-if="draft" class="link-editor-body">
        <q-input
          v-model="draft.title"
          label="title"
          placeholder="what is this link called?"
          dense
          filled
          square
          dark
          :maxlength="LINK_TITLE_MAX"
          counter
          @update:model-value="touch"
        />

        <q-input
          v-if="!isHeader"
          v-model="draft.subtitle"
          label="subtitle"
          placeholder="optional, one short line"
          dense
          filled
          square
          dark
          :maxlength="LINK_SUBTITLE_MAX"
          counter
          @update:model-value="touch"
        />

        <q-input
          v-if="!isHeader"
          v-model="draft.url"
          label="url"
          placeholder="https://example.com/you"
          dense
          filled
          square
          dark
          :error="!!urlError"
          :error-message="urlError"
          @update:model-value="touch"
        />

        <template v-if="!isHeader">
          <div class="text-xs text-muted">icon</div>
          <q-tabs
            v-model="iconTab"
            dense
            no-caps
            align="justify"
            class="link-editor-tabs"
            active-color="primary"
            indicator-color="primary"
          >
            <q-tab name="platform" label="platform" />
            <q-tab name="icon" label="icon" />
            <q-tab name="emoji" label="emoji" />
            <q-tab name="upload" label="upload" />
          </q-tabs>

          <q-tab-panels v-model="iconTab" animated class="link-editor-panels bg-transparent">
            <q-tab-panel name="platform" class="link-editor-panel">
              <q-input
                v-model="platformFilter"
                placeholder="search platforms"
                dense
                filled
                square
                dark
                clearable
                class="mb-2"
              >
                <template #prepend><q-icon name="mdi-magnify" /></template>
              </q-input>
              <div v-if="!filteredPlatformOptions.length" class="text-xs text-muted">
                no platform matches “{{ platformFilter }}” — pick any icon from the icon tab instead
              </div>
              <div class="icon-grid">
                <button
                  v-for="option in filteredPlatformOptions"
                  :key="option.value"
                  type="button"
                  class="icon-cell"
                  :class="{
                    'is-active':
                      draft.icon.kind === 'platform' && draft.icon.value === option.platform,
                  }"
                  :title="option.label"
                  :aria-label="option.label"
                  :aria-pressed="
                    draft.icon.kind === 'platform' && draft.icon.value === option.platform
                  "
                  @click="pickPlatform(option.platform!)"
                >
                  <q-icon :name="option.value" />
                </button>
              </div>
            </q-tab-panel>

            <q-tab-panel name="icon" class="link-editor-panel">
              <div v-for="group in ICON_LIBRARY" :key="group.id" class="icon-group">
                <div class="text-xs text-muted">{{ group.label }}</div>
                <div class="icon-grid">
                  <button
                    v-for="option in group.options"
                    :key="`${group.id}-${option.value}`"
                    type="button"
                    class="icon-cell"
                    :class="{
                      'is-active': draft.icon.kind === 'icon' && draft.icon.value === option.value,
                    }"
                    :title="option.label"
                    :aria-label="option.label"
                    :aria-pressed="draft.icon.kind === 'icon' && draft.icon.value === option.value"
                    @click="pickIcon(option.value)"
                  >
                    <q-icon :name="option.value" />
                  </button>
                </div>
              </div>
            </q-tab-panel>

            <q-tab-panel name="emoji" class="link-editor-panel">
              <div class="icon-grid">
                <button
                  v-for="emoji in EMOJI_PRESETS"
                  :key="emoji"
                  type="button"
                  class="icon-cell icon-cell-emoji"
                  :class="{
                    'is-active': draft.icon.kind === 'emoji' && draft.icon.value === emoji,
                  }"
                  :aria-label="`use ${emoji}`"
                  :aria-pressed="draft.icon.kind === 'emoji' && draft.icon.value === emoji"
                  @click="pickEmoji(emoji)"
                >
                  {{ emoji }}
                </button>
              </div>
            </q-tab-panel>

            <q-tab-panel name="upload" class="link-editor-panel">
              <div class="flex items-center gap-3">
                <div class="icon-preview">
                  <img v-if="draft.icon.kind === 'image'" :src="draft.icon.value" alt="" />
                  <q-icon v-else name="mdi-image-outline" />
                </div>
                <div class="flex-1">
                  <q-file
                    v-model="uploadFile"
                    label="icon image"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    dense
                    filled
                    square
                    dark
                    :loading="uploading"
                    @update:model-value="onUpload"
                  />
                  <div class="text-xs text-muted mt-1">
                    png, jpeg, webp or gif · square works best
                  </div>
                  <div v-if="uploadError" class="text-xs text-negative mt-1" role="alert">
                    {{ uploadError }}
                  </div>
                </div>
              </div>
            </q-tab-panel>
          </q-tab-panels>

          <div class="flex items-center gap-3">
            <div class="icon-preview thumb-preview">
              <img v-if="draft.thumb" :src="draft.thumb" alt="" />
              <q-icon v-else name="mdi-image-outline" />
            </div>
            <div class="flex-1 min-w-0">
              <q-file
                v-model="thumbFile"
                label="thumbnail"
                accept="image/png,image/jpeg,image/webp,image/gif"
                dense
                filled
                square
                dark
                :loading="thumbUploading"
                @update:model-value="onThumbUpload"
              />
              <div class="text-xs text-muted mt-1 flex items-center gap-2">
                <span>shown in the card and grid layouts</span>
                <q-btn
                  v-if="draft.thumb"
                  flat
                  dense
                  no-caps
                  size="sm"
                  label="remove"
                  @click="clearThumb"
                />
              </div>
              <div v-if="thumbError" class="text-xs text-negative mt-1" role="alert">
                {{ thumbError }}
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <q-select
              v-model="draft.style"
              :options="styleOptions"
              label="style"
              dark
              filled
              square
              dense
              emit-value
              map-options
              @update:model-value="touch"
            />
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted">accent</span>
              <q-input
                v-model="draft.accent"
                dark
                filled
                square
                dense
                class="flex-1"
                @update:model-value="touch"
              >
                <template #prepend>
                  <div
                    class="w-4 h-4 rounded-sm"
                    :style="{ background: draft.accent || 'transparent' }"
                  ></div>
                </template>
                <template #append>
                  <q-icon name="mdi-eyedropper" class="cursor-pointer">
                    <q-popup-proxy><q-color v-model="draft.accent" dark /></q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>
            </div>
          </div>

          <div class="flex flex-wrap gap-4">
            <q-toggle
              v-model="draft.featured"
              label="featured"
              dense
              dark
              @update:model-value="touch"
            />
            <q-toggle
              v-model="draft.visible"
              label="visible"
              dense
              dark
              @update:model-value="touch"
            />
          </div>
        </template>
      </q-card-section>

      <div v-if="applyError" class="text-xs text-negative px-4 pb-2" role="alert">
        {{ applyError }}
      </div>

      <q-card-actions class="link-editor-actions">
        <q-btn flat color="negative" label="delete" no-caps @click="remove" />
        <div class="flex items-center gap-2">
          <q-btn flat color="primary" label="cancel" no-caps @click="close" />
          <q-btn color="primary" label="apply" no-caps :disable="!dirty" @click="apply" />
        </div>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useDashboardStore } from 'src/stores/dashboard';
import { EMOJI_PRESETS, ICON_LIBRARY } from 'src/constants/linkIcons';
import { LINK_SUBTITLE_MAX, LINK_TITLE_MAX } from 'src/utils/profileLinks';
import { PLATFORM_ICONS, parseSocialUrl, recognizeSocialDomain } from 'src/utils/socialLinks';
import type { ProfileLink } from 'src/types/profile';

const props = defineProps<{
  modelValue: boolean;
  link: ProfileLink | null;
  /**
   * Optional rule check run before the edit is emitted. Returning a message keeps the
   * dialog open and shows it, so a rule can never be broken by an edit that only the
   * editor can see (e.g. the one-unrecognised-link limit across the whole list).
   */
  validate?: (link: ProfileLink) => string | null;
}>();
const emit = defineEmits<{
  'update:modelValue': [boolean];
  apply: [ProfileLink];
  remove: [string];
}>();

const $q = useQuasar();
const dashboardStore = useDashboardStore();

const draft = ref<ProfileLink | null>(null);
const original = ref('');
const dirty = ref(false);
const iconTab = ref<'platform' | 'icon' | 'emoji' | 'upload'>('platform');
const uploadFile = ref<File | null>(null);
const uploading = ref(false);
const uploadError = ref('');
const applyError = ref('');
const thumbFile = ref<File | null>(null);
const thumbUploading = ref(false);
const thumbError = ref('');

const isHeader = computed(() => draft.value?.kind === 'header');

const styleOptions = [
  { label: 'follow layout', value: 'inherit' },
  { label: 'button', value: 'button' },
  { label: 'icon only', value: 'icon' },
  { label: 'text', value: 'text' },
  { label: 'card', value: 'card' },
];

/** Platform glyphs, ordered by the recognition table, as { platform, glyph, label }. */
const platformOptions = computed(() =>
  Object.entries(PLATFORM_ICONS).map(([platform, glyph]) => ({
    platform,
    value: glyph,
    label: platform,
  })),
);

/** 200+ platforms: without a filter the grid is a wall of icons. */
const platformFilter = ref('');
const filteredPlatformOptions = computed(() => {
  const needle = platformFilter.value.trim().toLowerCase().replace(/^@/, '');
  if (!needle) return platformOptions.value;
  return platformOptions.value.filter(
    (option) =>
      option.label.includes(needle) ||
      option.platform.includes(needle) ||
      needle.startsWith(option.platform),
  );
});

const urlError = computed(() => {
  if (!draft.value || isHeader.value) return '';
  const url = draft.value.url ?? '';
  if (!url.trim()) return 'a url is required';
  return parseSocialUrl(url) ? '' : 'needs a full http(s) address, without credentials';
});

/** Which tab the current icon kind maps to, so opening a row lands somewhere sensible. */
function tabForIcon(link: ProfileLink): typeof iconTab.value {
  if (link.icon.kind === 'emoji') return 'emoji';
  if (link.icon.kind === 'image') return 'upload';
  if (link.icon.kind === 'icon') return 'icon';
  return 'platform';
}

watch(
  () => [props.modelValue, props.link] as const,
  ([open, link]) => {
    if (!open || !link) return;
    draft.value = JSON.parse(JSON.stringify(link)) as ProfileLink;
    original.value = JSON.stringify(link);
    dirty.value = false;
    applyError.value = '';
    uploadFile.value = null;
    uploadError.value = '';
    iconTab.value = tabForIcon(link);
  },
  { immediate: true },
);

function touch() {
  applyError.value = '';
  dirty.value = JSON.stringify(draft.value) !== original.value;
}

function close() {
  emit('update:modelValue', false);
}

function pickPlatform(platform: string) {
  if (!draft.value) return;
  draft.value.icon = { kind: 'platform', value: platform };
  if (!draft.value.title.trim()) draft.value.title = platform;
  touch();
}

function pickIcon(value: string) {
  if (!draft.value) return;
  draft.value.icon = { kind: 'icon', value };
  touch();
}

function pickEmoji(emoji: string) {
  if (!draft.value) return;
  draft.value.icon = { kind: 'emoji', value: emoji };
  touch();
}

async function onUpload(file: File | null) {
  if (!file || !draft.value) return;
  uploadError.value = '';
  uploading.value = true;
  try {
    const url = await dashboardStore.uploadFile(file, 'linkIcon');
    if (!url) {
      uploadError.value = dashboardStore.error || 'upload failed';
      return;
    }
    draft.value.icon = { kind: 'image', value: url };
    touch();
  } finally {
    uploading.value = false;
    uploadFile.value = null;
  }
}

async function onThumbUpload(file: File | null) {
  if (!file || !draft.value) return;
  thumbError.value = '';
  thumbUploading.value = true;
  try {
    const url = await dashboardStore.uploadFile(file, 'linkThumb');
    if (!url) {
      thumbError.value = dashboardStore.error || 'upload failed';
      return;
    }
    draft.value.thumb = url;
    touch();
  } finally {
    thumbUploading.value = false;
    thumbFile.value = null;
  }
}

function clearThumb() {
  if (!draft.value) return;
  draft.value.thumb = null;
  touch();
}

/** Apply a pasted URL's platform/icon when the user opens the popup with nothing set. */
function syncIconFromUrl() {
  if (!draft.value || isHeader.value) return;
  const parsed = parseSocialUrl(draft.value.url ?? '');
  if (!parsed) return;
  const platform = recognizeSocialDomain(parsed);
  if (!platform) return;
  // Only auto-fill when the user has not picked anything deliberate yet.
  if (draft.value.icon.kind === 'icon' && draft.value.icon.value === 'mdi-link')
    draft.value.icon = { kind: 'platform', value: platform };
}

function apply() {
  if (!draft.value) return;
  if (!isHeader.value) {
    // The server drops links it cannot parse; refuse locally so nothing silently vanishes.
    const parsed = parseSocialUrl(draft.value.url ?? '');
    if (!parsed) {
      uploadError.value = '';
      return;
    }
    draft.value.url = parsed.href;
    if (!draft.value.title.trim()) draft.value.title = parsed.hostname.replace(/^www\./, '');
    syncIconFromUrl();
  } else if (!draft.value.title.trim()) {
    return;
  }
  const ruleError = props.validate?.(draft.value);
  if (ruleError) {
    applyError.value = ruleError;
    return;
  }
  emit('apply', draft.value);
  emit('update:modelValue', false);
}

function remove() {
  if (!draft.value) return;
  emit('remove', draft.value.id);
  emit('update:modelValue', false);
}
</script>

<style scoped>
.link-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0;
}

.link-editor-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
}

.link-editor-tabs {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.link-editor-panels {
  min-height: 150px;
}

.link-editor-panel {
  padding: 8px 0;
  max-height: 210px;
  overflow-y: auto;
}

.icon-group + .icon-group {
  margin-top: 10px;
}

.icon-group .text-xs {
  margin-bottom: 6px;
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
}

.icon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: transparent;
  color: #ddd;
  cursor: pointer;
  font-size: 17px;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background-color 0.15s ease;
}

.icon-cell:hover {
  border-color: #f00;
  color: #fff;
}

.icon-cell:focus-visible {
  outline: 2px solid #f00;
  outline-offset: 1px;
}

.icon-cell.is-active {
  border-color: #f00;
  color: #fff;
  background: rgba(255, 0, 0, 0.12);
}

.icon-cell-emoji {
  font-size: 19px;
}

.icon-preview {
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  font-size: 22px;
}

.icon-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 7px;
}

.thumb-preview img {
  object-fit: cover;
}

.link-editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 0;
}
</style>

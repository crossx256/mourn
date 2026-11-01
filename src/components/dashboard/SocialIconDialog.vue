<template>
  <q-dialog :model-value="modelValue" @update:model-value="onModel" @show="onShow">
    <q-card dark class="social-icon-dialog">
      <q-card-section>
        <div class="dash-section-title">icon · {{ platformLabel }}</div>
        <p class="text-muted text-xs">
          give this platform its own icon in the classic row. uploaded images, catalogue icons and
          emoji all work, exactly like the link list.
        </p>

        <div class="social-icon-current">
          <span class="social-icon-preview" aria-hidden="true">
            <img v-if="draft?.kind === 'image'" :src="draft.value" alt="" />
            <span v-else-if="draft?.kind === 'emoji'">{{ draft.value }}</span>
            <q-icon v-else :name="previewGlyph" />
          </span>
          <span class="text-xs text-muted">{{ draftLabel }}</span>
        </div>

        <q-tabs v-model="tab" dense no-caps align="left" class="social-icon-tabs">
          <q-tab name="icon" label="icon" />
          <q-tab name="emoji" label="emoji" />
          <q-tab name="upload" label="upload" />
        </q-tabs>

        <q-tab-panels v-model="tab" animated class="bg-transparent social-icon-panels">
          <q-tab-panel name="icon" class="social-icon-panel">
            <q-input
              v-model="filter"
              dark
              filled
              square
              dense
              clearable
              placeholder="search icons"
              class="mb-3"
            >
              <template #prepend>
                <q-icon name="mdi-magnify" />
              </template>
            </q-input>
            <div class="social-icon-scroll">
              <div v-for="group in visibleGroups" :key="group.id" class="social-icon-group">
                <div class="text-xs text-muted">{{ group.label }}</div>
                <div class="social-icon-grid">
                  <button
                    v-for="option in group.options"
                    :key="`${group.id}-${option.value}`"
                    type="button"
                    class="social-icon-cell"
                    :class="{
                      'is-active': draft?.kind === 'icon' && draft.value === option.value,
                    }"
                    :title="option.label"
                    :aria-label="option.label"
                    :aria-pressed="draft?.kind === 'icon' && draft.value === option.value"
                    @click="pickIcon(option.value)"
                  >
                    <q-icon :name="option.value" />
                  </button>
                </div>
              </div>
              <p v-if="!visibleGroups.length" class="text-muted text-xs">
                no icon matches “{{ filter }}”
              </p>
            </div>
          </q-tab-panel>

          <q-tab-panel name="emoji" class="social-icon-panel">
            <div class="social-icon-grid">
              <button
                v-for="emoji in EMOJI_PRESETS"
                :key="emoji"
                type="button"
                class="social-icon-cell social-icon-cell-emoji"
                :class="{ 'is-active': draft?.kind === 'emoji' && draft.value === emoji }"
                :aria-label="`use ${emoji}`"
                :aria-pressed="draft?.kind === 'emoji' && draft.value === emoji"
                @click="pickEmoji(emoji)"
              >
                {{ emoji }}
              </button>
            </div>
          </q-tab-panel>

          <q-tab-panel name="upload" class="social-icon-panel">
            <div class="flex items-center gap-3">
              <div class="social-icon-preview social-icon-preview-large" aria-hidden="true">
                <img v-if="draft?.kind === 'image'" :src="draft.value" alt="" />
                <q-icon v-else name="mdi-image-outline" />
              </div>
              <div class="flex-1">
                <q-file
                  v-model="uploadFile"
                  dark
                  filled
                  square
                  dense
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  label="pick an image"
                  :disable="uploading"
                  :loading="uploading"
                  @update:model-value="onUpload"
                />
                <p class="text-muted text-xs mt-1 mb-0">
                  png, jpg, webp or gif. square images look best; it replaces the platform icon on
                  your page.
                </p>
              </div>
            </div>
            <p v-if="uploadError" class="text-negative text-xs">{{ uploadError }}</p>
          </q-tab-panel>
        </q-tab-panels>
      </q-card-section>

      <q-card-actions align="right" class="q-px-md q-pb-md">
        <q-btn flat no-caps label="use platform icon" class="text-muted" @click="save(null)" />
        <q-btn flat no-caps label="cancel" v-close-popup />
        <q-btn
          unelevated
          no-caps
          color="primary"
          label="save"
          :disable="!draft"
          @click="save(draft)"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { EMOJI_PRESETS, ICON_LIBRARY } from 'src/constants/linkIcons';
import { PLATFORM_ICONS, socialIconDisplay } from 'src/utils/socialLinks';
import type { ProfileLinkIcon } from 'src/types/profile';

const props = defineProps<{
  modelValue: boolean;
  /** Platform key the icon belongs to (also the socialLinks key). */
  platformKey: string;
  platformLabel: string;
  current: ProfileLinkIcon | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [icon: ProfileLinkIcon | null];
}>();

const tab = ref<'icon' | 'emoji' | 'upload'>('icon');
const filter = ref('');
const draft = ref<ProfileLinkIcon | null>(null);
const uploadFile = ref<File | null>(null);
const uploading = ref(false);
const uploadError = ref('');

const previewGlyph = computed(() => {
  const display = socialIconDisplay(draft.value, PLATFORM_ICONS[props.platformKey] || 'mdi-link');
  return display.icon ?? 'mdi-link';
});

const draftLabel = computed(() => {
  if (!draft.value) return 'using the platform icon';
  if (draft.value.kind === 'image') return 'your uploaded image';
  if (draft.value.kind === 'emoji') return `emoji ${draft.value.value}`;
  if (draft.value.kind === 'platform') return `platform icon · ${draft.value.value}`;
  return draft.value.value;
});

const visibleGroups = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  if (!needle) return ICON_LIBRARY;
  return ICON_LIBRARY.map((group) => ({
    ...group,
    options: group.options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
    ),
  })).filter((group) => group.options.length);
});

function onModel(value: boolean) {
  emit('update:modelValue', value);
}

function onShow() {
  draft.value = props.current ?? null;
  filter.value = '';
  uploadError.value = '';
  uploadFile.value = null;
  // Open on the tab that matches what is stored, so "edit" lands where the user expects.
  if (props.current?.kind === 'emoji') tab.value = 'emoji';
  else if (props.current?.kind === 'image') tab.value = 'upload';
  else tab.value = 'icon';
}

function pickIcon(value: string) {
  draft.value = { kind: 'icon', value };
}

function pickEmoji(emoji: string) {
  draft.value = { kind: 'emoji', value: emoji };
}

async function onUpload(file: File | null) {
  if (!file) return;
  uploadError.value = '';
  uploading.value = true;
  try {
    const { useDashboardStore } = await import('src/stores/dashboard');
    const store = useDashboardStore();
    const url = await store.uploadFile(file, 'linkIcon');
    if (!url) {
      uploadError.value = store.error || 'upload failed';
      return;
    }
    draft.value = { kind: 'image', value: url };
  } finally {
    uploading.value = false;
  }
}

function save(icon: ProfileLinkIcon | null) {
  emit('save', icon);
  emit('update:modelValue', false);
}
</script>

<style scoped>
.social-icon-dialog {
  width: 520px;
  max-width: 94vw;
  background: #0f0f12;
  border: 1px solid #26262c;
}

.social-icon-current {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.75rem 0;
}

.social-icon-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid #2a2a30;
  background: #141418;
  font-size: 1.3rem;
  overflow: hidden;
}

.social-icon-preview-large {
  width: 64px;
  height: 64px;
  font-size: 1.9rem;
}

.social-icon-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.social-icon-tabs {
  border-bottom: 1px solid #222228;
  color: #8a8a92;
}

.social-icon-panels {
  margin-top: 0.5rem;
}

.social-icon-panel {
  padding: 0;
}

.social-icon-scroll {
  max-height: 320px;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.social-icon-group + .social-icon-group {
  margin-top: 0.75rem;
}

.social-icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
  margin-top: 0.35rem;
}

.social-icon-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  border: 1px solid #26262c;
  background: #141418;
  color: #d7d7dd;
  font-size: 1.1rem;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease;
}

.social-icon-cell:hover {
  border-color: rgba(255, 0, 0, 0.45);
}

.social-icon-cell:focus-visible {
  outline: 2px solid rgba(255, 0, 0, 0.6);
  outline-offset: 1px;
}

.social-icon-cell.is-active {
  border-color: rgba(255, 0, 0, 0.75);
  background: rgba(255, 0, 0, 0.12);
  color: #fff;
}

.social-icon-cell-emoji {
  font-size: 1.15rem;
}
</style>

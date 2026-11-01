<template>
  <q-dialog v-model="dialogOpen" persistent>
    <q-card dark class="bg-black text-white cropper-dialog" style="width: 460px; max-width: 95vw">
      <q-card-section class="flex justify-between items-center pb-2">
        <span class="text-primary text-sm font-bold font-mono lowercase tracking-wide">
          crop profile picture
        </span>
        <q-btn round flat dense icon="mdi-close" color="grey" size="sm" @click="cancel" />
      </q-card-section>

      <q-card-section class="flex flex-col items-center gap-4 py-2">
        <!-- Cropper -->
        <div class="cropper-wrap w-full" style="height: 320px">
          <Cropper
            v-if="imageSrc"
            ref="cropperRef"
            :src="imageSrc"
            :stencil-component="CircleStencil"
            :stencil-props="{ aspectRatio: 1 }"
            :canvas="{ maxWidth: 512, maxHeight: 512 }"
            class="w-full h-full"
            image-restriction="stencil"
            background-class="bg-black"
          />
        </div>

        <!-- Preview -->
        <div class="flex items-center gap-3">
          <span class="text-xs text-muted">preview</span>
          <div
            class="w-12 h-12 rounded-full overflow-hidden border border-solid border-dash-border bg-dash-panel"
          >
            <img
              v-if="previewUrl"
              :src="previewUrl"
              class="w-full h-full object-cover"
              alt="preview"
            />
          </div>
          <div
            class="w-16 h-16 rounded-full overflow-hidden border border-solid border-dash-border bg-dash-panel"
          >
            <img
              v-if="previewUrl"
              :src="previewUrl"
              class="w-full h-full object-cover"
              alt="preview"
            />
          </div>
        </div>
      </q-card-section>

      <q-card-actions align="right" class="bg-dash-panel px-4 py-3">
        <q-btn flat no-caps label="cancel" color="grey" class="text-xs" @click="cancel" />
        <q-btn
          flat
          no-caps
          label="crop & upload"
          color="primary"
          class="text-xs font-bold"
          :loading="uploading"
          @click="cropAndUpload"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch, shallowRef } from 'vue';
import { Cropper, CircleStencil } from 'vue-advanced-cropper';
import 'vue-advanced-cropper/dist/style.css';

/* ----------------------------------------------------------------
   Props & Emits
   ---------------------------------------------------------------- */
const props = defineProps<{
  modelValue: boolean;
  file: File | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  cropped: [file: File];
}>();

/* ----------------------------------------------------------------
   State
   ---------------------------------------------------------------- */
const dialogOpen = ref(props.modelValue);
const cropperRef = shallowRef<InstanceType<typeof Cropper> | null>(null);
const imageSrc = ref('');
const previewUrl = ref('');
const uploading = ref(false);

let previewTimer: ReturnType<typeof setTimeout> | null = null;

/* ----------------------------------------------------------------
   Sync v-model
   ---------------------------------------------------------------- */
watch(
  () => props.modelValue,
  (val) => {
    dialogOpen.value = val;
  },
);
watch(dialogOpen, (val) => {
  emit('update:modelValue', val);
});

/* ----------------------------------------------------------------
   Load file into cropper when it changes
   ---------------------------------------------------------------- */
watch(
  () => props.file,
  (file) => {
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        imageSrc.value = (e.target?.result as string) || '';
      };
      reader.readAsDataURL(file);
    } else {
      imageSrc.value = '';
      previewUrl.value = '';
    }
  },
  { immediate: true },
);

/* ----------------------------------------------------------------
   Live preview with debounce — updates on cropper interaction
   ---------------------------------------------------------------- */
watch(imageSrc, () => {
  // Refresh preview shortly after the image loads into the cropper
  schedulePreview();
});

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    updatePreview();
  }, 300);
}

function updatePreview() {
  if (!cropperRef.value) return;
  const { canvas } = cropperRef.value.getResult();
  if (canvas) {
    previewUrl.value = canvas.toDataURL('image/webp', 0.8);
  }
}

/* ----------------------------------------------------------------
   Crop, compress, and emit the resulting File
   ---------------------------------------------------------------- */
async function cropAndUpload() {
  if (!cropperRef.value) return;
  uploading.value = true;

  try {
    const { canvas } = cropperRef.value.getResult();
    if (!canvas) return;

    // Draw into a fixed-size canvas (max 512×512) for compression
    const size = Math.min(canvas.width, 512);
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(canvas, 0, 0, size, size);

    // Export as compressed webp blob
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, 'image/webp', 0.82),
    );

    if (!blob) return;

    const file = new File([blob], 'avatar.webp', { type: 'image/webp' });
    emit('cropped', file);
    dialogOpen.value = false;
  } finally {
    uploading.value = false;
  }
}

/* ----------------------------------------------------------------
   Cancel
   ---------------------------------------------------------------- */
function cancel() {
  dialogOpen.value = false;
}
</script>

<style scoped>
.cropper-dialog {
  border: 1px solid #1a1a1a;
}

.cropper-wrap {
  border-radius: 4px;
  overflow: hidden;
  background: #0a0a0a;
}

/* Override cropper internals for dark theme */
:deep(.vue-advanced-cropper__background) {
  background: #000 !important;
}
:deep(.vue-advanced-cropper__foreground) {
  background: rgba(0, 0, 0, 0.6) !important;
}
:deep(.vue-circle-stencil__preview) {
  border: 2px solid rgba(255, 0, 0, 0.6) !important;
}
:deep(.vue-simple-handler) {
  background: #ff0000 !important;
  width: 10px !important;
  height: 10px !important;
}
:deep(.vue-simple-line) {
  border-color: rgba(255, 0, 0, 0.4) !important;
}
</style>

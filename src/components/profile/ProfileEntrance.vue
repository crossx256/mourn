<template>
  <q-dialog
    v-model="visible"
    maximized
    no-refocus
    aria-label="Enter profile"
    transition-show="fade"
    transition-hide="fade"
    @hide="dismiss"
  >
    <button
      type="button"
      autofocus
      class="entrance-overlay"
      :style="{ backgroundColor: overlayColor, opacity: overlayOpacity }"
      @click="dismiss"
    >
      <span class="entrance-text" :style="{ fontFamily: `'${font}', sans-serif`, color: textColor }">
        {{ text }}
      </span>
    </button>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

withDefaults(
  defineProps<{
    text?: string;
    font?: string;
    textColor?: string;
    overlayColor?: string;
    overlayOpacity?: number;
  }>(),
  {
    text: 'click to enter',
    font: 'Courier New',
    textColor: '#ffffff',
    overlayColor: '#000000',
    overlayOpacity: 0.9,
  },
);
const emit = defineEmits<{ dismissed: [] }>();
const visible = ref(false);
let dismissed = false;
onMounted(() => { visible.value = true; });
function dismiss() {
  if (dismissed) return;
  dismissed = true;
  visible.value = false;
  emit('dismissed');
}
</script>

<style scoped>
.entrance-overlay {
  width: 100%;
  height: 100%;
  margin: 0;
  border: 0;
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.entrance-text {
  font-size: clamp(1.5rem, 6vw, 3rem);
  overflow-wrap: anywhere;
  text-align: center;
  animation: entrance-pulse 2s ease-in-out infinite;
}
.entrance-overlay:focus-visible .entrance-text {
  outline: 2px solid currentColor;
  outline-offset: 12px;
}
@keyframes entrance-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.02); opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .entrance-text { animation: none; }
}
</style>

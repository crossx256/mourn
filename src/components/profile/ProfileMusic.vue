<template>
  <div class="music-controls-fixed">
    <audio
      ref="audioEl"
      :src="musicUrl"
      crossorigin="anonymous"
      :loop="loop"
      preload="metadata"
      @play="isPlaying = true"
      @pause="isPlaying = false"
      @ended="isPlaying = false"
      @error="isPlaying = false"
    />
    <button
      type="button"
      class="mute-btn glassmorphism-btn"
      :aria-label="isPlaying ? 'Pause music' : 'Play music'"
      :aria-pressed="isPlaying"
      :disabled="blocked"
      @click="togglePlayback"
    >
      <q-icon :name="isPlaying ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark'" />
    </button>
    <input type="range" class="volume-slider-fixed" aria-label="Music volume" min="0" max="100" :value="volume" @input="onVolumeChange" />
    <span v-if="playbackError" class="music-error" role="status">Music unavailable. Try play again.</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
const props = withDefaults(
  defineProps<{ musicUrl: string; blocked?: boolean; musicVolume?: number; autoplay?: boolean; loop?: boolean }>(),
  { blocked: false, musicVolume: 0.5, autoplay: false, loop: true },
);
const audioEl = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const playbackError = ref(false);
const volume = ref(Math.round(Math.max(0, Math.min(1, props.musicVolume)) * 100));
let disposed = false;
let playbackGeneration = 0;
let awaitingAutoplay = props.autoplay;

async function playAudio(entranceGesture = false) {
  const audio = audioEl.value;
  if (!audio || !props.musicUrl || (props.blocked && !entranceGesture) || disposed) return;
  const generation = ++playbackGeneration;
  playbackError.value = false;
  audio.volume = volume.value / 100;
  try {
    await audio.play();
    if (disposed || props.blocked && !entranceGesture) audio.pause();
    else awaitingAutoplay = false;
  } catch {
    if (!disposed && generation === playbackGeneration) {
      isPlaying.value = false;
      playbackError.value = true;
    }
  }
}
function pauseAudio() {
  playbackGeneration++;
  audioEl.value?.pause();
  isPlaying.value = false;
}
function autoplayAfterGesture() {
  if (!awaitingAutoplay || !props.autoplay || props.blocked || isPlaying.value) return;
  void playAudio();
}
function togglePlayback() {
  awaitingAutoplay = false;
  if (isPlaying.value) pauseAudio();
  else void playAudio();
}
function onVolumeChange(event: Event) {
  volume.value = Number((event.target as HTMLInputElement).value);
  if (audioEl.value) audioEl.value.volume = volume.value / 100;
}
watch(() => props.musicVolume, (value) => {
  volume.value = Math.round(Math.max(0, Math.min(1, value)) * 100);
  if (audioEl.value) audioEl.value.volume = volume.value / 100;
});
watch(() => [props.musicUrl, props.blocked, props.autoplay] as const, () => {
  pauseAudio();
  playbackError.value = false;
  awaitingAutoplay = props.autoplay;
  if (props.autoplay && !props.blocked && !isPlaying.value) void playAudio();
}, { flush: 'post' });
onMounted(() => {
  if (props.autoplay && !props.blocked) void playAudio();
  window.addEventListener('pointerdown', autoplayAfterGesture);
  window.addEventListener('keydown', autoplayAfterGesture);
});
onBeforeUnmount(() => {
  disposed = true;
  pauseAudio();
  window.removeEventListener('pointerdown', autoplayAfterGesture);
  window.removeEventListener('keydown', autoplayAfterGesture);
  audioEl.value?.removeAttribute('src');
  audioEl.value?.load();
});
defineExpose({ playAfterEntrance: () => { if (props.autoplay) void playAudio(true); } });
</script>

<style scoped>
.music-controls-fixed {
  background: rgba(0, 0, 0, 0.4);
  padding: 8px 1.2rem 8px 8px;
  border-radius: 30px;
  backdrop-filter: blur(10px);
  max-width: calc(100vw - 32px);
}
.volume-slider-fixed {
  background: rgba(255, 255, 255, 0.2) !important;
  opacity: 1 !important;
  width: 80px !important;
}
.music-controls-fixed :focus-visible { outline: 2px solid white; outline-offset: 3px; }
.music-error { display: block; font-size: 12px; }
</style>

<template>
  <div class="profile-bio" :class="animClass">
    <template v-if="useTypewriter">
      <span class="bio-accessible">{{ bio }}</span>
      <div class="typewriter-container" aria-hidden="true">
        <span class="typewriter-text">{{ displayedText }}</span>
        <span class="typewriter-cursor">|</span>
      </div>
    </template>
    <template v-else>{{ bio }}</template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRenderingPolicy } from 'src/composables/useRenderingPolicy';

const props = defineProps<{ bio: string; descriptionAnimation: string | null }>();
const { animate } = useRenderingPolicy();
const mounted = ref(false);
const useTypewriter = computed(() => mounted.value && animate.value && props.descriptionAnimation === 'typewriter');
const animClass = computed(() => animate.value && props.descriptionAnimation === 'fade' ? 'anim-fade' : '');
const displayedText = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
function stop() { clearTimeout(timer); timer = undefined; }
watch([() => props.bio, useTypewriter], ([bio, enabled]) => {
  stop();
  displayedText.value = bio;
  if (!enabled || !bio) return;
  const characters = Array.from(bio);
  let index = 0;
  let deleting = false;
  displayedText.value = '';
  function tick() {
    index += deleting ? -1 : 1;
    displayedText.value = characters.slice(0, index).join('');
    let delay = 75;
    if (index === characters.length) { deleting = true; delay = 2000; }
    else if (index === 0) deleting = false;
    timer = setTimeout(tick, delay);
  }
  timer = setTimeout(tick, 75);
}, { immediate: true });
onMounted(() => { mounted.value = true; });
onBeforeUnmount(stop);
</script>

<style scoped>
.bio-accessible {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

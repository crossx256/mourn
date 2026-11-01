<template>
  <div class="relative w-full h-full" @dblclick="resetCamera">
    <TresCanvas
      clear-color="#000000"
      window-size
      :dpr="lowMotion ? 1 : [1, 1.5]"
      :fps-limit="lowMotion ? 30 : 60"
      :gl="{
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: false,
      }"
    >
      <VoidScene
        ref="sceneRef"
        :letters="letters"
        :time-progress="timeProgress"
        @node-click="(letter: Letter) => emit('node-click', letter)"
      />

      <!-- Enhanced Post-processing: cinematic bloom + chromatic aberration + film grain + vignette + lens distortion -->
      <Suspense v-if="!lowMotion">
        <EffectComposerPmndrs>
          <!-- Dramatic HDR Bloom for stars -->
          <DepthOfFieldPmndrs :focal-length="0.04" :focus-distance="0" :bokeh-scale="1.0" />

          <!-- Chromatic Aberration (lens distortion color fringing) -->

          <BloomPmndrs
            :intensity="0.6"
            :luminance-threshold="0.95"
            :luminance-smoothing="0.9"
            :mipmap-blur="true"
          />

          <!-- Vignette (darkens edges like looking through a telescope) -->
          <VignettePmndrs :darkness="0.85" :offset="0.4" />
          <!-- Enhanced chromatic aberration for lens flare color fringing -->
          <ChromaticAberrationPmndrs :offset="chromaticAberrationOffsetEnhanced" />
          <!-- Depth of Field (dynamic - focuses on where camera is looking) -->
        </EffectComposerPmndrs>
      </Suspense>
    </TresCanvas>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRenderingPolicy } from 'src/composables/useRenderingPolicy';
import { TresCanvas } from '@tresjs/core';
import {
  EffectComposerPmndrs,
  BloomPmndrs,
  VignettePmndrs,
  ChromaticAberrationPmndrs,
  DepthOfFieldPmndrs,
} from '@tresjs/post-processing';
import { Vector2 } from 'three';
import VoidScene from './VoidScene.vue';
import type { Letter } from 'src/types/graveyard';

defineProps<{
  letters: Letter[];
  timeProgress: number;
}>();

const emit = defineEmits<{
  'node-click': [letter: Letter];
}>();

const { lowMotion } = useRenderingPolicy();

// Post-processing effect parameters - enhanced for lens flare appearance
const chromaticAberrationOffsetEnhanced = new Vector2(0.0012, 0.0012);

const sceneRef = ref<{
  resetCamera: () => void;
  flyToNode: (id: string) => void;
} | null>(null);

function resetCamera() {
  if (sceneRef.value) {
    sceneRef.value.resetCamera();
  }
}

function flyToNode(letterId: string) {
  if (sceneRef.value) {
    sceneRef.value.flyToNode(letterId);
  }
}

defineExpose({ resetCamera, flyToNode });
</script>

<template>
  <div class="user-count-display">
    <!-- Scanline overlay -->
    <div class="user-count-scanlines" />

    <!-- Chromatic aberration -->
    <div class="user-count-chromatic user-count-chromatic--red" />
    <div class="user-count-chromatic user-count-chromatic--cyan" />

    <div class="user-count-content relative z-1">
      <span class="user-count-label">registered users</span>
      <span class="user-count-value">
        {{ formattedCount }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ count: number }>();

const formattedCount = computed(() => props.count.toLocaleString());
</script>

<style scoped>
.user-count-display {
  background: var(--black, #000);
  border: none;
  position: relative;
  overflow: hidden;
  font-family: 'Courier New', 'Consolas', monospace;
}

/* Scanlines */
.user-count-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgb(var(--m-bg-rgb, 0 0 0) / 0.1) 2px,
    rgba(0, 0, 0, 0.1) 4px
  );
  opacity: 0.5;
}

/* Chromatic aberration */
.user-count-chromatic {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
  mix-blend-mode: screen;
}

.user-count-chromatic--red {
  box-shadow: inset 1px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.06);
  animation: chrRed 6s ease-in-out infinite;
}

.user-count-chromatic--cyan {
  box-shadow: inset -1px 0 0 rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.04);
  animation: chrCyan 6s ease-in-out infinite;
}

@keyframes chrRed {
  0%,
  100% {
    transform: translate(0.5px, 0);
    opacity: 0.4;
  }
  50% {
    transform: translate(1.5px, -0.5px);
    opacity: 0.7;
  }
}

@keyframes chrCyan {
  0%,
  100% {
    transform: translate(-0.5px, 0);
    opacity: 0.3;
  }
  50% {
    transform: translate(-1px, 0.5px);
    opacity: 0.6;
  }
}

/* Content */
.user-count-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 10px 20px;
}

.user-count-label {
  font-size: 10px;
  letter-spacing: 0.2em;

  color: var(--dash-muted, #888);
}

.user-count-label::before {
  content: '[';
  color: var(--primary, #ff0000);
  opacity: 0.7;
  margin-right: 4px;
}

.user-count-label::after {
  content: ']';
  color: var(--primary, #ff0000);
  opacity: 0.7;
  margin-left: 4px;
}

.user-count-value {
  font-size: 14px;
  letter-spacing: 0.1em;
  color: var(--primary, #ff0000);
  font-weight: 600;
  text-shadow: 0 0 8px rgb(var(--m-accent-rgb, 255 0 0) / 0.3);
  animation: countPulse 3s ease-in-out infinite;
}

@keyframes countPulse {
  0%,
  100% {
    opacity: 0.9;
  }
  50% {
    opacity: 1;
    text-shadow: 0 0 12px rgb(var(--m-accent-rgb, 255 0 0) / 0.5);
  }
}
</style>

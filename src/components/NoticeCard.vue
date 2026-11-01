<template>
  <q-card class="notice-card bg-black" square flat>
    <!-- Scanline overlay -->
    <div class="notice-scanlines" />

    <!-- Chromatic aberration -->
    <div class="notice-chromatic notice-chromatic--red" />
    <div class="notice-chromatic notice-chromatic--cyan" />

    <q-card-section :class="['relative z-1', isMobile ? 'q-pr-xl' : '']">
      <q-btn
        v-if="isMobile"
        icon="mdi-close"
        flat
        dense
        class="absolute-top-right text-primary q-ma-sm"
        @click="$emit('close')"
      />

      <!-- Terminal header -->
      <div class="notice-header">
        <span class="notice-header-bracket">[</span>
        <span class="notice-header-text">ANNOUNCEMENTS</span>
        <span class="notice-header-bracket">]</span>
        <span class="notice-header-cursor">&#x2588;</span>
      </div>

      <div class="notice-divider" />

      <div v-if="activeAnnouncements && activeAnnouncements.length > 0" class="flex flex-col gap-4">
        <div v-for="(announcement, index) in activeAnnouncements" :key="index" class="notice-entry">
          <div class="notice-title" v-if="announcement.title">
            <span class="notice-prompt">&gt;</span>
            {{ announcement.title }}
          </div>
          <div class="notice-timestamp">
            {{ new Date(announcement.createdAt).toISOString().replace('T', ' ').slice(0, 16) }}
          </div>
          <div class="notice-body">
            {{ announcement.body }}
          </div>
          <div v-if="index < activeAnnouncements.length - 1" class="notice-separator" />
        </div>
      </div>
      <div v-else class="notice-empty"><span class="notice-prompt">&gt;</span> loading...</div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import type { Announcement } from 'src/types/system';
import { computed } from 'vue';

const props = defineProps<{
  announcements: Announcement[];
  isMobile?: boolean;
}>();
defineEmits<{ close: [] }>();

const activeAnnouncements = computed(() =>
  props.announcements.filter((announcement) => announcement.isActive),
);
</script>

<style scoped>
.notice-card {
  border: none;
  position: relative;
  overflow: hidden;
  font-family: 'Courier New', 'Consolas', monospace;
}

/* Scanlines */
.notice-scanlines {
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
  animation: noticeScanScroll 10s steps(4, end) infinite;
}

@keyframes noticeScanScroll {
  0% {
    transform: translate3d(0, 0, 0);
  }
  100% {
    transform: translate3d(0, 4px, 0);
  }
}

/* Chromatic aberration */
.notice-chromatic {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
  mix-blend-mode: screen;
}

.notice-chromatic--red {
  box-shadow: inset 1px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.08);
  animation: noticeChrRed 5s ease-in-out infinite;
}

.notice-chromatic--cyan {
  box-shadow: inset -1px 0 0 rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.05);
  animation: noticeChrCyan 5s ease-in-out infinite;
}

@keyframes noticeChrRed {
  0%,
  100% {
    transform: translate(0.5px, 0);
    opacity: 0.5;
  }
  50% {
    transform: translate(2px, -0.5px);
    opacity: 1;
  }
}

@keyframes noticeChrCyan {
  0%,
  100% {
    transform: translate(-0.5px, 0);
    opacity: 0.4;
  }
  50% {
    transform: translate(-1.5px, 0.5px);
    opacity: 0.8;
  }
}

/* Header */
.notice-header {
  font-size: 11px;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: var(--primary);
  margin-bottom: 4px;
  text-shadow:
    1px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.3),
    -1px 0 0 rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.2);
}

.notice-header-bracket {
  color: var(--primary);
  opacity: 0.7;
}

.notice-header-text {
  margin: 0 4px;
  animation: noticeHeaderPulse 3s ease-in-out infinite;
}

.notice-header-cursor {
  color: var(--primary);
  font-size: 10px;
  margin-left: 6px;
  animation: noticeCursorBlink 0.8s step-end infinite;
}

@keyframes noticeHeaderPulse {
  0%,
  100% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
}

@keyframes noticeCursorBlink {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

/* Divider */
.notice-divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgb(var(--m-accent-rgb, 255 0 0) / 0.3) 20%,
    rgb(var(--m-accent-rgb, 255 0 0) / 0.3) 80%,
    transparent
  );
  margin: 8px 0 12px;
  position: relative;
  overflow: hidden;
}

.notice-divider::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgb(var(--m-accent-rgb, 255 0 0) / 0.6), transparent);
  animation: noticeDividerSweep 4s ease-in-out infinite;
}

@keyframes noticeDividerSweep {
  0% {
    left: -40%;
  }
  100% {
    left: 100%;
  }
}

/* Entry */
.notice-entry {
  position: relative;
}

/* Timestamp */
.notice-timestamp {
  font-size: 9px;
  letter-spacing: 0.15em;
  color: #555;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.notice-prompt {
  color: var(--primary);
  font-weight: bold;
  margin-right: 4px;
}

/* Title */
.notice-title {
  color: var(--dash-text, #eee);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 4px;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Body */
.notice-body {
  color: var(--dash-text, #eee);
  font-size: 13px;
  line-height: 1.6;
  letter-spacing: 0.02em;
  word-wrap: break-word;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  text-shadow:
    0.5px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.08),
    -0.5px 0 0 rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.05);
}

/* Separator between entries */
.notice-separator {
  height: 1px;
  background: rgba(255, 255, 255, 0.04);
  margin-top: 16px;
}

/* Empty state */
.notice-empty {
  color: #444;
  font-size: 11px;
  letter-spacing: 0.1em;
  animation: noticeEmptyPulse 2s ease-in-out infinite;
}

@keyframes noticeEmptyPulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
</style>

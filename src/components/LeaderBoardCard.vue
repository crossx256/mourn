<template>
  <q-card class="mini-leaderboard" square flat>
    <!-- Scanline overlay -->
    <div class="leaderboard-scanlines" />

    <!-- Chromatic aberration -->
    <div class="leaderboard-chromatic leaderboard-chromatic--red" />
    <div class="leaderboard-chromatic leaderboard-chromatic--cyan" />

    <q-card-section class="relative z-1">
      <div class="leaderboard-header">
        <span class="leaderboard-header-bracket">[</span>
        <q-icon name="mdi-trophy" size="14px" class="q-mx-xs" />
        <span>top profiles</span>
        <span class="leaderboard-header-bracket">]</span>
      </div>
    </q-card-section>

    <q-separator />

    <q-card-section class="q-pa-none relative z-1">
      <q-inner-loading :showing="loading" dark color="primary">
        <div class="loading-text">loading...</div>
      </q-inner-loading>

      <q-list dark separator class="MPleaderboard-list">
        <q-item
          v-for="(profile, index) in profiles"
          :key="profile.username"
          :to="`/${profile.username}`"
          clickable
          class="MPleaderboard-item"
        >
          <q-item-section side class="MPleaderboard-rank" :data-rank="index + 1">
            #{{ index + 1 }}
          </q-item-section>
          <q-item-section class="MPleaderboard-username">
            {{ profile.username }}
          </q-item-section>
          <q-item-section side class="MPleaderboard-rep">
            {{ profile.reputation ?? 0 }} rep
          </q-item-section>
        </q-item>

        <q-item v-if="!loading && profiles.length === 0">
          <q-item-section class="MPleaderboard-empty"> no signals detected </q-item-section>
        </q-item>
      </q-list>
    </q-card-section>

    <q-btn
      to="/leaderboard"
      flat
      square
      color="primary"
      class="full-width MPleaderboard-view-all relative z-1"
      label="view leaderboards"
      icon-right="mdi-arrow-right"
    />
  </q-card>
</template>

<script setup lang="ts">
defineProps<{
  profiles: Array<{ username: string; reputation?: number | null }>;
  loading: boolean;
}>();
</script>

<style scoped>
.mini-leaderboard {
  background: rgb(var(--m-surface-rgb, 0 0 0)) !important;
  border: none;
  position: relative;
  overflow: hidden;
  font-family: 'Courier New', 'Consolas', monospace;
}

/* Scanlines */
.leaderboard-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgb(var(--m-bg-rgb, 0 0 0) / 0.1) 2px,
    rgb(var(--m-bg-rgb, 0 0 0) / 0.1) 4px
  );
  animation: scanScroll 10s steps(4, end) infinite;
}

@keyframes scanScroll {
  0% {
    transform: translate3d(0, 0, 0);
  }
  100% {
    transform: translate3d(0, 4px, 0);
  }
}

/* Chromatic aberration */
.leaderboard-chromatic {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
  mix-blend-mode: screen;
}

.leaderboard-chromatic--red {
  box-shadow: inset 1px 0 0 rgba(255, 0, 0, 0.08);
  animation: chrRed 5s ease-in-out infinite;
}

.leaderboard-chromatic--cyan {
  box-shadow: inset -1px 0 0 rgba(0, 255, 255, 0.05);
  animation: chrCyan 5s ease-in-out infinite;
}

@keyframes chrRed {
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

@keyframes chrCyan {
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
.leaderboard-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 11px;
  letter-spacing: 0.4em;

  color: var(--primary, #ff0000);
  text-shadow:
    1px 0 0 rgba(255, 0, 0, 0.3),
    -1px 0 0 rgba(0, 255, 255, 0.2);
  animation: headerPulse 3s ease-in-out infinite;
}

.leaderboard-header-bracket {
  color: var(--primary, #ff0000);
  opacity: 0.7;
}

@keyframes headerPulse {
  0%,
  100% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
}

/* Loading text */
.loading-text {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--dash-muted, #888);
  margin-top: 8px;
}

.loading-text::before {
  content: '> ';
  color: var(--primary, #ff0000);
}

/* Divider gradient */
:deep(.q-separator) {
  background: linear-gradient(
    90deg,
    transparent,
    rgb(var(--m-accent-rgb, 255 0 0) / 0.3) 20%,
    rgb(var(--m-accent-rgb, 255 0 0) / 0.3) 80%,
    transparent
  ) !important;
}

/* List styling */
.MPleaderboard-list {
  background: transparent;
}

.MPleaderboard-list :deep(.q-item) {
  min-height: 44px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  transition: all 0.2s ease;
}

.MPleaderboard-list :deep(.q-item):last-child {
  border-bottom: none;
}

/* Rank styling */
:deep(.MPleaderboard-rank) {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  min-width: 32px;
  color: rgb(var(--m-accent-rgb, 255 0 0)) !important;
  opacity: 0.9;
}

/* Top three stay distinct by weight/glow, not by a fixed medal colour, so the
   panel matches whatever palette is active. */
:deep(.MPleaderboard-rank)[data-rank='1'] {
  color: rgb(var(--m-accent-rgb, 255 0 0)) !important;
  font-weight: 700;
  text-shadow: 0 0 8px rgb(var(--m-accent-rgb, 255 0 0) / 0.45);
}

:deep(.MPleaderboard-rank)[data-rank='2'] {
  color: rgb(var(--m-accent-rgb, 255 0 0) / 0.8) !important;
  font-weight: 700;
  text-shadow: 0 0 8px rgb(var(--m-accent-rgb, 255 0 0) / 0.3);
}

:deep(.MPleaderboard-rank)[data-rank='3'] {
  color: rgb(var(--m-accent-rgb, 255 0 0) / 0.65) !important;
  font-weight: 700;
  text-shadow: 0 0 8px rgb(var(--m-accent-rgb, 255 0 0) / 0.2);
}

/* Username styling */
:deep(.MPleaderboard-username) {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 13px;
  letter-spacing: 0.05em;
  color: var(--dash-text, #eee) !important;
}

/* Reputation styling */
:deep(.MPleaderboard-rep) {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--dash-muted, #888) !important;
}

/* Empty state */
:deep(.MPleaderboard-empty) {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--dash-muted, #888);
  text-align: center;
  padding: 24px;
}

:deep(.MPleaderboard-empty)::before {
  content: '> ';
  color: var(--primary, #ff0000);
}

/* View all button */
:deep(.MPleaderboard-view-all) {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 10px;
  letter-spacing: 0.2em;
  border-top: 1px solid var(--border, #30363d);
  transition: color 0.25s ease;
  padding: 12px;
}

:deep(.MPleaderboard-view-all:hover) {
  color: var(--primary, #ff0000) !important;
}

:deep(.q-inner-loading) {
  background: rgba(0, 0, 0, 0.8) !important;
  z-index: 10;
}
</style>

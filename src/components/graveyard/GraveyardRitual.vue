<template>
  <Transition name="ritual-fade">
    <div v-if="active" class="ritual-overlay" @pointerdown="unlockAudio">
      <!-- Scanline overlay -->
      <div class="ritual-scanlines" />

      <!-- Random glitch flash -->
      <div v-if="glitchFlash" class="ritual-glitch-flash" />

      <!-- Chromatic aberration layers -->
      <div class="ritual-chromatic ritual-chromatic--red" />
      <div class="ritual-chromatic ritual-chromatic--cyan" />

      <!-- Hex data stream (top) -->
      <div v-if="showHexStreams" class="hex-stream hex-stream--top">
        <span
          v-for="(chunk, i) in hexTop"
          :key="'t' + i"
          class="hex-char"
          :style="{ opacity: 0.15 + Math.random() * 0.25 }"
          >{{ chunk }}</span
        >
      </div>

      <!-- Center content — fixed width -->
      <div class="ritual-center">
        <!-- Cryptic header -->
        <div class="ritual-header">
          <span class="ritual-header-bracket">[</span>
          <span class="ritual-header-text">SIGNAL DETECTED</span>
          <span class="ritual-header-bracket">]</span>
        </div>

        <!-- Typewriter line -->
        <div class="ritual-message">
          <span class="ritual-prompt">&gt;_</span>
          <span class="ritual-text">{{ displayedText }}</span>
          <span v-if="showCursor" class="ritual-cursor">&#x2588;</span>
        </div>

        <!-- Corrupted progress -->
        <div class="ritual-progress-wrap">
          <div class="ritual-progress-label">
            <span>DECRYPTING</span>
            <span class="ritual-progress-pct">{{ Math.floor(displayProgress) }}%</span>
          </div>
          <div class="ritual-progress-bar">
            <div class="ritual-progress-fill" :style="{ width: displayProgress + '%' }" />
            <div class="ritual-progress-glitch" />
          </div>
        </div>

        <!-- Cryptic status lines — synced to progress -->
        <div class="ritual-status">
          <div
            v-for="(line, i) in statusLines"
            :key="i"
            class="ritual-status-line"
            :class="{
              'ritual-status-line--done': i < activeStatusIdx,
              'ritual-status-line--active': i === activeStatusIdx,
            }"
          >
            <span class="ritual-status-marker">{{
              i <= activeStatusIdx ? '&#x2588;' : '&#x2591;'
            }}</span>
            <span>{{ line }}</span>
          </div>
        </div>
      </div>

      <!-- Hex data stream (bottom) -->
      <div v-if="showHexStreams" class="hex-stream hex-stream--bottom">
        <span
          v-for="(chunk, i) in hexBottom"
          :key="'b' + i"
          class="hex-char"
          :style="{ opacity: 0.1 + Math.random() * 0.2 }"
          >{{ chunk }}</span
        >
      </div>

      <!-- Bottom cryptic tip -->
      <div class="ritual-tip">
        {{ currentTip }}
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useDevicePreferencesStore } from 'src/stores/devicePreferences';

const props = defineProps<{
  active: boolean;
  progress: number;
}>();

const emit = defineEmits<{
  lineComplete: [];
  sequenceComplete: [];
}>();

const devicePreferencesStore = useDevicePreferencesStore();

// ── Cryptic lines ─────────────────────────────────────────────
const LINES = [
  'something stirs in the void.',
  'we are building a tomb for words that refuse to die.',
  'not the permanence they promise. a witness.',
  'proving something of us persisted.',
];

const TIPS = [
  'the graveyard remembers what you choose to forget.',
  '"if you are going through hell, keep going."',
  'you get one entry every two weeks. choose wisely.',
  '"the void does not judge. it only remembers."',
  'every letter needs approval before it enters.',
];

const STATUS_LINES = [
  'ESTABLISHING CONNECTION',
  'PARSING LETTER FRAGMENTS',
  'MAPPING VOID COORDINATES',
  'RECONSTRUCTING TIMELINE',
  'CHANNEL OPEN',
];

// ── State ────────────────────────────────────────────────────────
const displayedText = ref('');
const showCursor = ref(true);
const currentTip = ref(TIPS[0] ?? '');
const internalProgress = ref(0);
const glitchFlash = ref(false);
const hexTop = ref<string[]>([]);
const hexBottom = ref<string[]>([]);
const statusLines = ref(STATUS_LINES);
const activeStatusIdx = ref(-1);
const showHexStreams = computed(() => !devicePreferencesStore.performanceMode);

let typeTimer: ReturnType<typeof setTimeout> | null = null;
let tipTimer: ReturnType<typeof setInterval> | null = null;
let hexTimer: ReturnType<typeof setInterval> | null = null;
let glitchTimer: ReturnType<typeof setInterval> | null = null;
let progressTimer: ReturnType<typeof setInterval> | null = null;

// ── Display progress: slow internal ramp, capped by real progress ──
const displayProgress = computed(() => {
  // Use the slower of internal ramp vs real data progress
  // This way internal progress controls the speed, real progress is the ceiling
  return Math.min(internalProgress.value, Math.max(props.progress, internalProgress.value));
});

// ── Sync status lines to progress ──
watch(displayProgress, (pct) => {
  // Map progress to status line index (5 lines, spread across 0-100%)
  // 0-15% = line 0, 15-35% = line 1, 35-55% = line 2, 55-80% = line 3, 80-100% = line 4
  const thresholds = [0, 15, 35, 55, 80];
  let idx = -1;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (pct >= (thresholds[i] ?? 0)) {
      idx = i;
      break;
    }
  }
  activeStatusIdx.value = idx;
});

// ── Generate hex noise ──────────────────────────────────────────
function generateHex(count: number): string[] {
  const chars = '0123456789ABCDEF';
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let chunk = '';
    const len = Math.random() > 0.7 ? 4 : 2;
    for (let j = 0; j < len; j++) {
      chunk += chars[Math.floor(Math.random() * 16)];
    }
    out.push(chunk);
  }
  return out;
}

function refreshHex() {
  hexTop.value = generateHex(40);
  hexBottom.value = generateHex(40);
}

function stopAnimatedTimers() {
  if (typeTimer) clearTimeout(typeTimer);
  if (tipTimer) clearInterval(tipTimer);
  if (hexTimer) clearInterval(hexTimer);
  if (glitchTimer) clearInterval(glitchTimer);
  if (progressTimer) clearInterval(progressTimer);
  typeTimer = null;
  tipTimer = null;
  hexTimer = null;
  glitchTimer = null;
  progressTimer = null;
}

// ── Glitch flash effect ─────────────────────────────────────────
function triggerGlitch() {
  glitchFlash.value = true;
  setTimeout(
    () => {
      glitchFlash.value = false;
    },
    80 + Math.random() * 120,
  );
}

// ── Slow internal progress ramp ─────────────────────────────────
function startProgressRamp() {
  internalProgress.value = 0;
  // Ramp from 0 to 100 over ~12 seconds (120 ticks * 100ms = 12s)
  progressTimer = setInterval(() => {
    if (internalProgress.value < 100) {
      // Non-linear: slow start, faster mid, slow end
      const remaining = 100 - internalProgress.value;
      const step = Math.max(0.3, remaining * 0.02 + Math.random() * 0.5);
      internalProgress.value = Math.min(100, internalProgress.value + step);
    } else {
      if (progressTimer) clearInterval(progressTimer);
    }
  }, 100);
}

// ── Typewriter engine ───────────────────────────────────────────
function runTypewriter() {
  let lineIdx = 0;
  let charIdx = 0;

  const CHAR_DELAY = 55;
  const LINE_PAUSE = 2000;
  const CLEAR_PAUSE = 300;

  function typeNext() {
    if (lineIdx >= LINES.length) {
      showCursor.value = false;
      emit('sequenceComplete');
      return;
    }

    const line = LINES[lineIdx]!;

    if (charIdx <= line.length) {
      displayedText.value = line.slice(0, charIdx);
      playTypeSound();
      charIdx++;
      typeTimer = setTimeout(typeNext, CHAR_DELAY + Math.random() * 30);
    } else {
      typeTimer = setTimeout(() => {
        displayedText.value = '';
        charIdx = 0;
        lineIdx++;
        emit('lineComplete');
        typeTimer = setTimeout(typeNext, CLEAR_PAUSE);
      }, LINE_PAUSE);
    }
  }

  typeNext();
}

// ── Tip cycling ─────────────────────────────────────────────────
function startTipCycle() {
  let tipIdx = 0;
  tipTimer = setInterval(() => {
    tipIdx = (tipIdx + 1) % TIPS.length;
    currentTip.value = TIPS[tipIdx] ?? '';
  }, 8000);
}

// ── Typewriter sound (Web Audio) ────────────────────────────────
let audioCtx: AudioContext | null = null;
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  void audioCtx.resume().catch(() => {});
}

function playTypeSound() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 380 + Math.random() * 140;
  gain.gain.value = 0.04;

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.04, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
  osc.start(now);
  osc.stop(now + 0.03);
}

// ── Lifecycle ───────────────────────────────────────────────────
function startAll() {
  stopAnimatedTimers();
  displayedText.value = '';
  showCursor.value = true;
  currentTip.value = TIPS[0] ?? '';
  internalProgress.value = 0;
  activeStatusIdx.value = -1;
  refreshHex();
  runTypewriter();
  startTipCycle();
  startProgressRamp();

  if (!devicePreferencesStore.performanceMode) {
    hexTimer = setInterval(refreshHex, 600);
    glitchTimer = setInterval(() => {
      if (Math.random() > 0.6) triggerGlitch();
    }, 1500);
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  if (props.active) {
    startAll();
  }
});

watch(
  () => [props.active, devicePreferencesStore.performanceMode] as const,
  ([active]) => {
    if (!active) {
      cleanup();
      return;
    }

    startAll();
  },
  { immediate: true },
);

function cleanup() {
  stopAnimatedTimers();
  if (audioCtx) {
    void audioCtx.close();
    audioCtx = null;
  }
  audioUnlocked = false;
  window.removeEventListener('pointerdown', unlockAudio);
}

onUnmounted(cleanup);
</script>

<style scoped>
.ritual-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  user-select: none;
  overflow: hidden;
  font-family: 'Courier New', 'Consolas', monospace;
}

/* Scanlines */
.ritual-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgb(var(--m-bg-rgb, 0 0 0) / 0.15) 2px,
    rgba(0, 0, 0, 0.15) 4px
  );
  animation: scanlineScroll 8s steps(4, end) infinite;
}

@keyframes scanlineScroll {
  0% {
    transform: translate3d(0, 0, 0);
  }
  100% {
    transform: translate3d(0, 4px, 0);
  }
}

/* Glitch flash */
.ritual-glitch-flash {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  background: rgba(255, 0, 0, 0.03);
  animation: glitchFlicker 0.1s steps(2) forwards;
}

@keyframes glitchFlicker {
  0% {
    opacity: 1;
    transform: skewX(-1deg);
  }
  50% {
    opacity: 0.5;
    transform: skewX(0.5deg);
  }
  100% {
    opacity: 0;
    transform: none;
  }
}

/* ── Chromatic aberration ── */
.ritual-chromatic {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 15;
  mix-blend-mode: screen;
}

.ritual-chromatic--red {
  box-shadow: inset 2px 0 0 rgba(255, 0, 0, 0.12);
  animation: chromaticShiftRed 4s ease-in-out infinite;
}

.ritual-chromatic--cyan {
  box-shadow: inset -2px 0 0 rgba(0, 255, 255, 0.08);
  animation: chromaticShiftCyan 4s ease-in-out infinite;
}

@keyframes chromaticShiftRed {
  0%,
  100% {
    transform: translate(1px, 0);
    opacity: 0.6;
  }
  25% {
    transform: translate(3px, -1px);
    opacity: 1;
  }
  50% {
    transform: translate(0, 1px);
    opacity: 0.3;
  }
  75% {
    transform: translate(2px, 0);
    opacity: 0.8;
  }
}

@keyframes chromaticShiftCyan {
  0%,
  100% {
    transform: translate(-1px, 0);
    opacity: 0.5;
  }
  25% {
    transform: translate(-2px, 1px);
    opacity: 0.8;
  }
  50% {
    transform: translate(0, -1px);
    opacity: 0.3;
  }
  75% {
    transform: translate(-3px, 0);
    opacity: 0.7;
  }
}

/* Hex data streams */
.hex-stream {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 8px 16px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--primary);
  overflow: hidden;
  max-height: 60px;
  z-index: 1;
}

.hex-stream--top {
  top: 0;
}
.hex-stream--bottom {
  bottom: 40px;
}

.hex-char {
  transition: opacity 0.3s;
}

/* Center content — FIXED WIDTH */
.ritual-center {
  position: relative;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  width: 460px;
  max-width: 90vw;
  padding: 0 24px;
  box-sizing: border-box;
}

/* Header */
.ritual-header {
  font-size: 10px;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: var(--dash-muted);
  animation: headerPulse 3s ease-in-out infinite;
  text-shadow:
    1px 0 0 rgba(255, 0, 0, 0.3),
    -1px 0 0 rgba(0, 255, 255, 0.2);
}

.ritual-header-bracket {
  color: var(--primary);
}

.ritual-header-text {
  margin: 0 4px;
}

@keyframes headerPulse {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}

/* Typewriter message */
.ritual-message {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-height: 32px;
  width: 100%;
}

.ritual-prompt {
  color: var(--primary);
  font-size: 14px;
  font-weight: bold;
  flex-shrink: 0;
}

.ritual-text {
  color: var(--dash-text);
  font-size: 16px;
  font-weight: 300;
  letter-spacing: 0.02em;
  line-height: 1.5;
  text-shadow:
    1px 0 0 rgba(255, 0, 0, 0.15),
    -1px 0 0 rgba(0, 255, 255, 0.1);
}

.ritual-cursor {
  color: var(--primary);
  font-size: 14px;
  animation: cursorBlink 0.7s step-end infinite;
}

@keyframes cursorBlink {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

/* Progress bar */
.ritual-progress-wrap {
  width: 100%;
}

.ritual-progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  letter-spacing: 0.3em;
  color: var(--dash-muted);
  margin-bottom: 6px;
  text-transform: uppercase;
}

.ritual-progress-pct {
  color: var(--primary);
  font-weight: bold;
  text-shadow: 0 0 6px rgba(255, 0, 0, 0.4);
}

.ritual-progress-bar {
  position: relative;
  width: 100%;
  height: 3px;
  background: var(--dash-border);
  overflow: hidden;
}

.ritual-progress-fill {
  height: 100%;
  background: var(--primary);
  box-shadow: 0 0 8px rgba(255, 0, 0, 0.4);
  transition: width 0.15s ease-linear;
}

.ritual-progress-glitch {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 0, 0, 0.15) 45%,
    transparent 55%,
    rgba(0, 255, 255, 0.08) 80%,
    transparent 100%
  );
  animation: progressGlitch 2s ease-in-out infinite;
}

@keyframes progressGlitch {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

/* Status lines */
.ritual-status {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.ritual-status-line {
  font-size: 9px;
  letter-spacing: 0.15em;
  color: #333;
  text-transform: uppercase;
  transition:
    color 0.4s,
    text-shadow 0.4s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ritual-status-line--done {
  color: var(--dash-muted);
}

.ritual-status-line--active {
  color: var(--primary);
  text-shadow:
    1px 0 0 rgba(255, 0, 0, 0.3),
    -1px 0 0 rgba(0, 255, 255, 0.2);
}

.ritual-status-marker {
  color: var(--primary);
  font-size: 7px;
}

/* Bottom tip */
.ritual-tip {
  position: absolute;
  bottom: 12px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: #333;
  z-index: 5;
  font-style: italic;
  text-shadow:
    1px 0 0 rgba(255, 0, 0, 0.15),
    -1px 0 0 rgba(0, 255, 255, 0.1);
}

/* Transitions */
.ritual-fade-enter-active {
  transition: opacity 0.3s ease;
}

.ritual-fade-leave-active {
  transition: opacity 0.8s ease;
}

.ritual-fade-enter-from,
.ritual-fade-leave-to {
  opacity: 0;
}
</style>

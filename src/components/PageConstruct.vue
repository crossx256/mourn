<template>
  <div class="construct-wrapper">
    <!-- Page content behind -->
    <div class="page-content" :class="{ 'page-revealed': complete }">
      <slot />
    </div>

    <!-- Terminal boot overlay -->
    <Transition name="overlay-fade">
      <div v-if="!complete" class="terminal-overlay" @click="skip">
        <!-- Scanlines -->
        <div class="scanlines" />

        <!-- Chromatic aberration layers -->
        <div class="chromatic-layer chromatic-red" />
        <div class="chromatic-layer chromatic-cyan" />

        <!-- Random glitch flash -->

        <!-- Hex data streams -->
        <div class="hex-stream hex-stream--top">
          <span
            v-for="(chunk, i) in hexTop"
            :key="'t' + i"
            class="hex-char"
            :style="{ opacity: 0.1 + Math.random() * 0.2 }"
            >{{ chunk }}</span
          >
        </div>

        <!-- Terminal -->
        <div class="terminal">
          <!-- Header -->
          <div class="terminal-header">
            <span class="header-bracket">[</span>
            <span class="header-text">{{ headerText }}</span>
            <span class="header-bracket">]</span>
            <span v-if="showCursor" class="cursor">&#x2588;</span>
          </div>

          <!-- Divider with sweep -->
          <div class="terminal-divider">
            <div class="divider-sweep" />
          </div>

          <!-- Typewriter output -->
          <div class="terminal-output">
            <!-- Previous completed lines -->
            <div
              v-for="(line, i) in completedLines"
              :key="i"
              class="output-line"
              :class="{ 'line-glitch': line.glitch }"
            >
              <span class="line-prompt">&gt;</span>
              <span class="line-text">{{ line.text }}</span>
            </div>

            <!-- Currently typing line -->
            <div v-if="currentLine.text" class="output-line line-active">
              <span class="line-prompt">&gt;</span>
              <span class="line-text">{{ currentLine.text }}</span>
              <span v-if="showCursor" class="line-cursor">&#x2588;</span>
            </div>
          </div>

          <!-- Progress -->
          <div class="terminal-progress">
            <div class="progress-info">
              <span>initializing</span>
              <span class="progress-pct">{{ Math.floor(progress) }}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: progress + '%' }" />
              <div class="progress-glitch" />
            </div>
          </div>

          <!-- Cryptic status -->
          <div class="status-lines">
            <div
              v-for="(status, i) in statusLines"
              :key="i"
              class="status-line"
              :class="{
                'status-active': i === activeStatusIdx,
                'status-done': i < activeStatusIdx,
              }"
            >
              <span class="status-marker">{{
                i <= activeStatusIdx ? '&#x2588;' : '&#x2591;'
              }}</span>
              <span>{{ status }}</span>
            </div>
          </div>
        </div>

        <!-- Bottom hex stream -->
        <div class="hex-stream hex-stream--bottom">
          <span
            v-for="(chunk, i) in hexBottom"
            :key="'b' + i"
            class="hex-char"
            :style="{ opacity: 0.08 + Math.random() * 0.15 }"
            >{{ chunk }}</span
          >
        </div>

        <!-- Skip hint -->
        <div class="skip-hint">click anywhere to skip</div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { usePlatform } from 'src/composables/usePlatform';

const emit = defineEmits<{ complete: [] }>();

// NOTE: avoid reading `sessionStorage` at module-eval time to keep
// SSR and client initial DOM identical. We'll check sessionStorage
// inside `onMounted` instead.
const alreadyConstructed = false;

// Phones boot the sequence fast. See the typing-speed comment in typeLine().
const { isMobile } = usePlatform();
const bootFast = isMobile;

// State
const complete = ref(alreadyConstructed);
const completedLines = ref<Array<{ text: string; glitch?: boolean }>>([]);
const currentLine = ref({ text: '' });
const progress = ref(0);

const showCursor = ref(true);
const headerText = ref('LOADING');
const activeStatusIdx = ref(-1);

// Hex streams
const hexTop = ref<string[]>([]);
const hexBottom = ref<string[]>([]);

// Status lines - web connection/privacy focused
const statusLines = [
  'DNS_RESOLUTION',
  'TLS_HANDSHAKE',
  'CIPHER_NEGOTIATION',
  'CERTIFICATE_VERIFICATION',
  'CHANGE_IS_NEAR',
];

const timers: ReturnType<typeof setTimeout>[] = [];
const intervals: ReturnType<typeof setInterval>[] = [];

// Build comprehensive system info messages
function buildBootMessages(): string[] {
  const ua = navigator.userAgent;
  const cores = navigator.hardwareConcurrency || '?';
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || '?';

  // OS detection
  let os = 'Unknown OS';
  if (ua.includes('Windows NT 10.0')) os = 'Windows 10/11';
  else if (ua.includes('Windows NT 6.3')) os = 'Windows 8.1';
  else if (ua.includes('Windows NT 6.2')) os = 'Windows 8';
  else if (ua.includes('Windows NT 6.1')) os = 'Windows 7';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('CrOS')) os = 'ChromeOS';
  else if (ua.includes('iPhone')) os = 'iOS (iPhone)';
  else if (ua.includes('iPad')) os = 'iOS (iPad)';

  // Display
  const resolution = `${screen.width}x${screen.height}`;
  const colorDepth = screen.colorDepth;
  const pixelRatio = window.devicePixelRatio || 1;

  // GPU
  let gpuRenderer = 'Unknown';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl && gl instanceof WebGLRenderingContext) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
      }
    }
  } catch {
    /* silent */
  }

  // Locale
  const lang = navigator.language || 'en';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';

  return [
    `QBIOS (C) 2025 mourn | ${cores}C/${memory}GB | ${os}`,
    `GPU: ${gpuRenderer.substring(0, 50)}`,
    `Display: ${resolution} @ ${pixelRatio}x | ${colorDepth}-bit`,
    `Locale: ${lang} | ${timezone}`,
    '',
    'BIOS Date: 22-Dec-2025',
    `RAM: ${memory}GB [OK]`,
    '',
    'are you ready to change? [Y/n] Y',
    '',
    'C:> mourn.exe',
  ];
}

// Generate hex noise
function generateHex(count: number): string[] {
  const chars = '0123456789ABCDEF';
  return Array.from({ length: count }, () => {
    const len = Math.random() > 0.7 ? 4 : 2;
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * 16)]).join('');
  });
}

// Typewriter effect for a line.
//
// Mobile emits SEVERAL characters per tick instead of one-per-tick with a shorter
// delay: browsers clamp nested setTimeout to ~4ms, so shortening the delay alone
// still cost ~2.5s of pure typing on a phone. Chunking keeps the typewriter look
// and fits the whole sequence in ~1s.
const MOBILE_CHARS_PER_TICK = 3;

async function typeLine(text: string, onComplete: () => void) {
  currentLine.value.text = '';
  const chars = text.split('');
  const step = bootFast.value ? MOBILE_CHARS_PER_TICK : 1;

  for (let i = 0; i < chars.length; i += step) {
    currentLine.value.text += chars.slice(i, i + step).join('');

    const delay = bootFast.value ? 2 + Math.random() * 2 : 7 + Math.random() * 10;
    await new Promise((r) => {
      const t = setTimeout(r, delay);
      timers.push(t);
    });
  }

  // Line complete - move to completed
  completedLines.value.push({ text: currentLine.value.text, glitch: Math.random() > 0.85 });
  currentLine.value.text = '';
  onComplete();
}

// Skip
function skip() {
  timers.forEach(clearTimeout);
  intervals.forEach(clearInterval);
  complete.value = true;
  sessionStorage.setItem('pageConstructed', 'true');
  emit('complete');
}

onMounted(() => {
  // If the client has previously completed the construct sequence,
  // set the state now. This check must run only on the client so the
  // server-rendered HTML stays identical and avoids hydration
  // mismatches.
  if (typeof window !== 'undefined' && sessionStorage.getItem('pageConstructed') === 'true') {
    complete.value = true;
    emit('complete');
    return;
  }

  // Initialize hex streams
  hexTop.value = generateHex(40);
  hexBottom.value = generateHex(40);

  // Refresh hex periodically
  const hexInt = setInterval(() => {
    hexTop.value = generateHex(40);
    hexBottom.value = generateHex(40);
  }, 600);
  intervals.push(hexInt);

  // Cursor blink
  const cursorInt = setInterval(() => {
    showCursor.value = !showCursor.value;
  }, 530);
  intervals.push(cursorInt);

  // Progress bar animation - syncs with typing progress
  const progressInt = setInterval(() => {
    if (progress.value < 100) {
      progress.value += bootFast.value ? 9 + Math.random() * 4 : 1.2 + Math.random() * 0.8;
    }
  }, 80);
  intervals.push(progressInt);

  // Build messages and type all lines sequentially
  const BOOT_MESSAGES = buildBootMessages();

  // Map status lines to specific boot message indices for perfect sync
  const statusLineMap = [0, 2, 4, 6, 9]; // Which line completions trigger status updates

  let lineIdx = 0;
  function typeNext() {
    if (lineIdx < BOOT_MESSAGES.length) {
      void typeLine(BOOT_MESSAGES[lineIdx]!, () => {
        // Update status line when specific lines complete
        const statusIdx = statusLineMap.indexOf(lineIdx);
        if (statusIdx !== -1) {
          activeStatusIdx.value = statusIdx;
        }

        lineIdx++;
        setTimeout(typeNext, bootFast.value ? 16 : 80);
      });
    } else {
      // All lines typed - ensure all status lines are filled
      activeStatusIdx.value = statusLines.length - 1;

      // All lines typed - complete after delay
      setTimeout(
        () => {
          complete.value = true;
          sessionStorage.setItem('pageConstructed', 'true');
          emit('complete');
        },
        bootFast.value ? 180 : 600,
      );
    }
  }

  // Start typing after initial delay
  setTimeout(typeNext, bootFast.value ? 60 : 300);
});

onUnmounted(() => {
  timers.forEach(clearTimeout);
  intervals.forEach(clearInterval);
});
</script>

<style scoped>
.construct-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

/* Page content behind */
.page-content {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: 0.2;
  transform: scale(1.02);
  filter: blur(10px) brightness(0.3);
  /* MOURN PERF: was `all`. Only these three properties actually change on reveal;
     the shorthand also makes the browser watch every other animatable property on
     the app root. Narrowing it keeps the transition identical and the style
     recalculation cheap. */
  transition:
    opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.8s cubic-bezier(0.4, 0, 0.2, 1),
    filter 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}

.page-revealed {
  opacity: 1;
  transform: scale(1);
  /* MOURN PERF: was `blur(0) brightness(1)`. Anything other than `none` keeps the
     ENTIRE app subtree inside a filtered compositing layer for the rest of the
     session — on a weak GPU / WebKitGTK that re-rasterises the whole page instead
     of using the fast path. `blur(0)` and `none` are pixel-identical. */
  filter: none;
  pointer-events: auto;
  z-index: 10;
}

/* Terminal overlay */
.terminal-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Courier New', 'Consolas', monospace;
  overflow: hidden;
}

/* Scanlines */
.scanlines {
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
  animation: scanMove 8s steps(4, end) infinite;
}

@keyframes scanMove {
  0% {
    transform: translate3d(0, 0, 0);
  }
  100% {
    transform: translate3d(0, 4px, 0);
  }
}

/* Chromatic aberration */
.chromatic-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 15;
  mix-blend-mode: screen;
}

.chromatic-red {
  box-shadow: inset 2px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.12);
  animation: chromaticRed 4s ease-in-out infinite;
}

.chromatic-cyan {
  box-shadow: inset -2px 0 0 rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.08);
  animation: chromaticCyan 4s ease-in-out infinite;
}

@keyframes chromaticRed {
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

@keyframes chromaticCyan {
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

/* Hex streams */
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
  color: var(--primary, #ff0000);
  overflow: hidden;
  max-height: 60px;
  z-index: 5;
  pointer-events: none;
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

/* Terminal */
.terminal {
  position: relative;
  z-index: 30;
  width: 90%;
  height: 80%;
  padding: 60px;
  display: flex;
  flex-direction: column;
}

/* Header */
.terminal-header {
  text-align: center;
  font-size: 16px;
  letter-spacing: 0.4em;
  color: var(--primary, #ff0000);
  margin-bottom: 16px;
  text-shadow:
    1px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.4),
    -1px 0 0 rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.25);
  animation: headerPulse 3s ease-in-out infinite;
}

.header-bracket {
  color: var(--primary, #ff0000);
  opacity: 0.7;
}

.header-text {
  margin: 0 4px;
}

.cursor {
  color: var(--primary, #ff0000);
  font-size: 14px;
  margin-left: 6px;
  animation: cursorBlink 0.7s step-end infinite;
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

/* Divider with sweep */
.terminal-divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgb(var(--m-accent-rgb, 255 0 0) / 0.3) 20%,
    rgb(var(--m-accent-rgb, 255 0 0) / 0.3) 80%,
    transparent
  );
  margin-bottom: 24px;
  position: relative;
  overflow: hidden;
}

.divider-sweep {
  position: absolute;
  top: 0;
  left: -40%;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgb(var(--m-accent-rgb, 255 0 0) / 0.6), transparent);
  animation: sweep 4s ease-in-out infinite;
}

@keyframes sweep {
  0% {
    left: -40%;
  }
  100% {
    left: 100%;
  }
}

/* Output */
.terminal-output {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 24px;
  font-size: 13px;
  line-height: 1.6;
}

.terminal-output::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.output-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--primary, #ff0000);
  margin-bottom: 4px;
}

.line-prompt {
  color: var(--primary, #ff0000);
  font-weight: bold;
  opacity: 0.8;
}

.line-text {
  color: var(--primary, #ff0000);
  text-shadow:
    0.5px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.3),
    -0.5px 0 0 rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.15);
}

.line-active .line-text {
  text-shadow:
    1px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.5),
    -1px 0 0 rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.25);
}

.line-cursor {
  color: var(--primary, #ff0000);
  animation: cursorBlink 0.7s step-end infinite;
  margin-left: 2px;
}

.line-glitch {
  animation: lineGlitch 0.2s ease;
}

@keyframes lineGlitch {
  0%,
  100% {
    transform: translate(0);
  }
  25% {
    transform: translate(-1px, 0);
  }
  50% {
    transform: translate(1px, 0);
  }
  75% {
    transform: translate(-0.5px, 0);
  }
}

/* Progress */
.terminal-progress {
  margin-bottom: 16px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  letter-spacing: 0.25em;
  color: rgb(var(--m-accent-rgb, 255 0 0) / 0.6);
  margin-bottom: 6px;
  text-transform: lowercase;
}

.progress-pct {
  color: var(--primary, #ff0000);
  font-weight: bold;
}

.progress-bar {
  height: 3px;
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.1);
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: var(--primary, #ff0000);
  box-shadow: 0 0 10px rgb(var(--m-accent-rgb, 255 0 0) / 0.5);
  transition: width 0.1s linear;
}

.progress-glitch {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgb(var(--m-accent-rgb, 255 0 0) / 0.2) 45%,
    transparent 55%,
    rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.1) 80%,
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
.status-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-line {
  font-size: 9px;
  letter-spacing: 0.15em;
  color: #333;
  text-transform: uppercase;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-active {
  color: var(--primary, #ff0000);
  text-shadow:
    1px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.3),
    -1px 0 0 rgb(var(--m-accentAlt-rgb, 0 255 255) / 0.2);
}

.status-done {
  color: rgb(var(--m-accent-rgb, 255 0 0) / 0.5);
}

.status-marker {
  font-size: 8px;
}

/* Skip hint */
.skip-hint {
  position: absolute;
  bottom: 20px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 9px;
  letter-spacing: 0.2em;
  color: #333;
  z-index: 30;
  cursor: pointer;
  transition: color 0.3s;
}

.skip-hint:hover {
  color: var(--primary, #ff0000);
}

/* Transition */
.overlay-fade-leave-active {
  transition:
    opacity 0.6s ease,
    transform 0.6s ease;
}

.overlay-fade-leave-to {
  opacity: 0;
  transform: scale(1.02);
}
</style>

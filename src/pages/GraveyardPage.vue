<template>
  <q-page class="graveyard-page bg-black">
    <!-- SSR GUARD: TheVoid.vue imports Three.js (Vector2) which crashes Node.js
         Wrap entire content so the server never attempts to render the 3D scene -->
    <q-no-ssr>
      <!-- ── Ritual loading overlay ── -->
      <GraveyardRitual
        :active="showRitual"
        :progress="loadProgress"
        @line-complete="onLineComplete"
        @sequence-complete="onSequenceComplete"
      />

      <!-- 3D Void -->
      <div class="void-wrapper">
        <TheVoid
          v-if="!webglFailed"
          :key="voidMountKey"
          ref="voidRef"
          :letters="graveyardStore.letters"
          :time-progress="timeProgress"
          @node-click="onNodeClick"
          @vue:error="onVoidError"
        />
        <!-- WebGL unavailable fallback (Tauri/WebKit context loss) -->
        <div
          v-else
          class="absolute inset-0 flex flex-col items-center justify-center gap-3"
          style="
            color: var(--dash-muted);
            font-family: monospace;
            font-size: 12px;
            letter-spacing: 0.1em;
          "
        >
          <span style="opacity: 0.4">[ 3D VOID UNAVAILABLE ]</span>
          <button
            class="text-[var(--primary)] underline"
            style="background: none; border: none; cursor: pointer; font-size: 11px"
            @click="retryWebgl"
          >
            retry
          </button>
        </div>
      </div>

      <!-- UI Layer (pointer-events-none so clicks pass to 3D) -->
      <div class="absolute inset-0 z-10 pointer-events-none">
        <!-- Graveyard Finder: Random Trip + Search — left column (works on desktop + mobile) -->
        <GraveyardFinder
          class="absolute left-4 md:left-8 top-4 md:top-1/2 md:-translate-y-1/2 z-20"
          @navigate="onNavigate"
        />

        <!-- Branding: top-left — hidden on mobile -->
        <div class="lt-md:hidden absolute top-0 left-0 p-8 md:p-12">
          <h1
            class="text-4xl md:text-5xl font-thin tracking-tighter m-0 uppercase"
            style="
              color: var(--dash-text);
              text-shadow:
                0 0 30px rgba(0, 0, 0, 0.9),
                0 0 60px rgba(0, 0, 0, 0.6);
            "
          >
            Graveyard
          </h1>
          <p
            class="text-xs tracking-[0.3em] uppercase mt-2 mb-0 font-light"
            style="color: var(--dash-muted); text-shadow: 0 0 20px rgba(0, 0, 0, 0.8)"
          >
            Letters of time
          </p>
        </div>

        <!-- Galaxy offline download / sync (desktop only + authorized) — aligned with the GRAVEYARD column -->
        <button
          v-if="offlineSurfaceVisible && galaxySyncState !== 'unknown'"
          type="button"
          class="galaxy-sync-btn pointer-events-auto absolute left-8 md:left-12 top-40 md:top-44"
          :disabled="galaxyBusy || galaxySyncState === 'synced' || galaxyOffline"
          :class="{
            'is-synced': galaxySyncState === 'synced',
            'is-stale': galaxySyncState === 'stale',
          }"
          @click="doGalaxySync"
        >
          {{ galaxyActionLabel }}
        </button>

        <!-- Offline galaxy badge (desktop only + authorized) — aligned with the GRAVEYARD column -->
        <div
          v-if="graveyardStore.offline && offlineSurfaceVisible"
          class="absolute top-28 md:top-32 left-8 md:left-12 pointer-events-none"
        >
          <span
            class="text-[9px] font-mono tracking-[0.25em] uppercase"
            style="color: var(--primary); text-shadow: 0 0 12px rgba(255, 0, 0, 0.5)"
          >
            [ offline galaxy ]
          </span>
        </div>

        <!-- Controls list: bottom-left — hidden on mobile (no keyboard on touch) -->
        <div class="lt-md:hidden absolute bottom-8 left-8 p-4">
          <div
            class="text-xs tracking-[0.2em] uppercase mb-3 font-light"
            style="color: var(--dash-text); text-shadow: 0 0 20px rgba(0, 0, 0, 0.8)"
          >
            Controls
          </div>
          <div class="flex flex-col gap-1 text-[10px] tracking-wider font-light font-mono">
            <div style="color: var(--dash-muted); text-shadow: 0 0 15px rgba(0, 0, 0, 0.8)">
              <span style="color: var(--primary)">F</span> — Toggle FPS Mode
            </div>
            <div style="color: var(--dash-muted); text-shadow: 0 0 15px rgba(0, 0, 0, 0.8)">
              <span style="color: var(--primary)">WASD</span> — Movement
            </div>
            <div style="color: var(--dash-muted); text-shadow: 0 0 15px rgba(0, 0, 0, 0.8)">
              <span style="color: var(--primary)">Shift</span> — Sprint
            </div>
            <div style="color: var(--dash-muted); text-shadow: 0 0 15px rgba(0, 0, 0, 0.8)">
              <span style="color: var(--primary)">ESC</span> — Exit FPS Mode
            </div>
            <div style="color: var(--dash-muted); text-shadow: 0 0 15px rgba(0, 0, 0, 0.8)">
              <span style="color: var(--primary)">Click</span> — Select Star
            </div>
            <div style="color: var(--dash-muted); text-shadow: 0 0 15px rgba(0, 0, 0, 0.8)">
              <span style="color: var(--primary)">Double Click</span> — Reset Camera
            </div>
          </div>
        </div>

        <!-- Red action button: top-right, prestige thin font, red fill -->
        <button
          class="soul-btn pointer-events-auto absolute top-8 right-8 text-xs tracking-[0.25em] uppercase px-6 py-3 rounded cursor-pointer transition-all duration-300 font-light border border-solid font-mono"
          @click="drawerOpen = true"
        >
          mourn
        </button>
      </div>

      <!-- Time Machine Slider: Bottom Center -->
      <div
        class="absolute bottom-12 left-1/2 -translate-x-1/2 w-full max-w-2xl px-8 z-20 pointer-events-auto flex flex-col items-center gap-2"
      >
        <div
          class="text-xs uppercase tracking-[0.2em] font-light"
          style="color: var(--dash-muted); text-shadow: 0 0 10px rgba(0, 0, 0, 0.8)"
        >
          <span class="mr-2">Timeline</span>
          <span style="color: var(--dash-text)">{{ formattedCurrentDate }}</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          v-model.number="timeProgress"
          class="time-slider"
        />
      </div>

      <!-- Letter popup -->
      <LetterDialog
        :letter="selectedLetter"
        @close="selectedLetter = null"
        @mention="openDrawerWithMention"
        @teleport="onTeleport"
      />

      <!-- Sidebar drawer -->
      <LetterDrawer v-model="drawerOpen" :reply-to="replyTarget" @submit="onSubmitLetter" />
    </q-no-ssr>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onErrorCaptured, nextTick, watch } from 'vue';
import { useQuasar } from 'quasar';
import TheVoid from 'components/graveyard/TheVoid.vue';
import LetterDialog from 'components/graveyard/LetterDialog.vue';
import LetterDrawer from 'components/graveyard/LetterDrawer.vue';
import GraveyardRitual from 'components/graveyard/GraveyardRitual.vue';
import GraveyardFinder from 'components/graveyard/GraveyardFinder.vue';
import type { Letter } from 'src/types/graveyard';
import { useGraveyardStore } from 'stores/graveyard';
import { isOfflineVaultEnabled } from 'src/crypto/offlineVault';
import { resolveOfflineAuthorizedSafely } from 'src/utils/offlineAuthorization';
import { reconcileActiveLetter } from 'components/graveyard/activeLetter';

// ---------------------------------------------------------------------------
const $q = useQuasar();
const graveyardStore = useGraveyardStore();

const GRAVEYARD_TRACK_URL = '/audio/graveyard-finish.mp3';
const GRAVEYARD_TRACK_VOLUME = 0.35;
const POST_SOUND_URL = '/audio/post.opus';
const POST_SOUND_VOLUME = 0.2;
let postAudio: HTMLAudioElement | null = null;
let graveyardAudio: HTMLAudioElement | null = null;
let graveyardAudioActive = false;
let waitingForAudioGesture = false;

function removeGraveyardAudioGestureListeners() {
  if (!waitingForAudioGesture) return;
  waitingForAudioGesture = false;
  document.removeEventListener('pointerdown', handleGraveyardAudioGesture);
  document.removeEventListener('keydown', handleGraveyardAudioGesture);
}

function waitForGraveyardAudioGesture() {
  if (!graveyardAudioActive || waitingForAudioGesture) return;
  waitingForAudioGesture = true;
  document.addEventListener('pointerdown', handleGraveyardAudioGesture);
  document.addEventListener('keydown', handleGraveyardAudioGesture);
}

function playGraveyardAudio() {
  if (!graveyardAudioActive || !graveyardAudio || document.visibilityState === 'hidden') return;

  void graveyardAudio
    .play()
    .then(removeGraveyardAudioGestureListeners)
    .catch(waitForGraveyardAudioGesture);
}

function handleGraveyardAudioGesture() {
  playGraveyardAudio();
}

function handleGraveyardVisibilityChange() {
  if (!graveyardAudio) return;
  if (document.visibilityState === 'hidden') {
    graveyardAudio.pause();
    return;
  }
  playGraveyardAudio();
}

function startGraveyardAudio() {
  graveyardAudioActive = true;
  graveyardAudio = new Audio(GRAVEYARD_TRACK_URL);
  graveyardAudio.loop = true;
  graveyardAudio.preload = 'auto';
  graveyardAudio.volume = GRAVEYARD_TRACK_VOLUME;
  document.addEventListener('visibilitychange', handleGraveyardVisibilityChange);
  playGraveyardAudio();
}

function playPostSound() {
  if (!postAudio) return;
  postAudio.currentTime = 0;
  void postAudio.play().catch((error: unknown) => {
    console.warn('[Graveyard] Post sound could not play:', error);
  });
}

function stopGraveyardAudio() {
  graveyardAudioActive = false;
  removeGraveyardAudioGestureListeners();
  document.removeEventListener('visibilitychange', handleGraveyardVisibilityChange);

  if (!graveyardAudio) return;
  graveyardAudio.pause();
  graveyardAudio.currentTime = 0;
  graveyardAudio.removeAttribute('src');
  graveyardAudio.load();
  graveyardAudio = null;
}

/** Offline galaxy badge only on the desktop (Tauri) runtime — zero web surface. */
const isDesktopVault = computed(() => isOfflineVaultEnabled());

/**
 * Authorized offline mode (krul 2026-08): desktop + authenticated on this
 * device + "stay logged in". Without it, the galaxy download/sync control and
 * offline badge disappear (the app just shows offline + retry).
 */
const offlineAuthorized = ref(false);
function resolveOfflineAuthorized() {
  // L18: a keychain/probe rejection must read as "not authorized", not as a
  // page error (onErrorCaptured would flip the 3D view to its WebGL fallback).
  return resolveOfflineAuthorizedSafely(async () => {
    const m = await import('src/crypto/offlineVault');
    return m.isOfflineModeAuthorized();
  }, (authorized) => {
    offlineAuthorized.value = authorized;
  });
}
/** All offline galaxy surfaces (sync control + badge) gate on this. */
const offlineSurfaceVisible = computed(() => isDesktopVault.value && offlineAuthorized.value);

// ── Galaxy offline download / sync state ──────────────────────
const galaxySyncState = ref<'unknown' | 'none' | 'stale' | 'synced'>('unknown');
const galaxyBusy = ref(false);
/** True when we're offline — disables download/sync while disconnected. */
const galaxyOffline = computed(() => typeof navigator !== 'undefined' && !navigator.onLine);

const galaxyActionLabel = computed(() => {
  if (galaxyBusy.value) return 'working…';
  if (galaxySyncState.value === 'synced') return 'synced';
  if (galaxySyncState.value === 'stale') return 'sync';
  if (galaxySyncState.value === 'none') return 'download the universe';
  return 'download the universe';
});

async function checkGalaxyState() {
  if (!isDesktopVault.value) {
    galaxySyncState.value = 'unknown';
    return;
  }
  const s = await graveyardStore.getGalaxyOfflineState();
  galaxySyncState.value = s.synced ? 'synced' : s.downloaded ? 'stale' : 'none';
}

async function doGalaxySync() {
  if (galaxyBusy.value) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    $q.notify({
      type: 'warning',
      message: 'You need a connection to download the galaxy.',
      timeout: 2500,
    });
    return;
  }
  galaxyBusy.value = true;
  try {
    // Ensure the letters are fresh before snapshotting what's shown offline.
    await graveyardStore.fetchLetters({ force: true });
    const ok = await graveyardStore.syncGalaxyOffline();
    if (ok) {
      $q.notify({
        type: 'positive',
        message: 'Galaxy saved for offline view.',
        timeout: 2500,
      });
    } else {
      $q.notify({
        type: 'negative',
        message: 'Could not save the galaxy for offline view.',
        timeout: 3000,
      });
    }
    await checkGalaxyState();
  } finally {
    galaxyBusy.value = false;
  }
}

// ── Ritual loading state ───────────────────────────────────────
// Start true to prevent the 3D scene from flashing before the ritual covers it
const showRitual = ref(true);
const sequenceDone = ref(false);
const lineDone = ref(false);

const loadProgress = computed(() => graveyardStore.progress);

function onSequenceComplete() {
  sequenceDone.value = true;
  dismissRitualWhenReady();
}

function onLineComplete() {
  // Progress within the sequence only; the overlay waits for the full sequence.
  lineDone.value = true;
}

/**
 * Dismiss once the whole title sequence has typed AND the letters are in. The
 * ritual is the loading screen for the void, so it must never show a frozen bar
 * over a page that is actually ready (or keep a reader waiting on a fetch that
 * hangs — RITUAL_MAX_WAIT_MS below covers that).
 */
let ritualDismissScheduled = false;
function dismissRitualWhenReady() {
  if (ritualDismissScheduled) return;
  if (!sequenceDone.value || graveyardStore.loading) return;
  ritualDismissScheduled = true;
  // Small grace period for the bar to visually fill
  requestAnimationFrame(() => {
    stopRitualGiveUp();
    showRitual.value = false;
  });
}

// The fetch can finish after the typewriter emits (slow network): re-check when
// either side completes instead of relying on the ritual's events alone.
watch(() => graveyardStore.loading, dismissRitualWhenReady);

// L19: fetchLetters() replaces the array (poll, offline hydrate, coming back to
// the page), so the open letter has to be re-resolved by id, not by object
// identity. Without this the popup kept a detached object and the next
// constellation/pinned re-query silently dropped the selection.
watch(
  () => graveyardStore.letters,
  (letters) => {
    if (!selectedLetter.value) return;
    selectedLetter.value = reconcileActiveLetter(selectedLetter.value, letters);
  },
);

/** Decoration must yield to the page: stop waiting after this long. */
const RITUAL_MAX_WAIT_MS = 12_000;
let ritualGiveUp: ReturnType<typeof setTimeout> | null = null;

function stopRitualGiveUp() {
  if (ritualGiveUp) clearTimeout(ritualGiveUp);
  ritualGiveUp = null;
}

// ── Data fetching ──────────────────────────────────────────────
onMounted(async () => {
  postAudio = new Audio(POST_SOUND_URL);
  postAudio.preload = 'auto';
  postAudio.volume = POST_SOUND_VOLUME;
  startGraveyardAudio();

  // Show ritual on first visit (hasFetched is false) or when explicitly requested
  const needsRitual = !graveyardStore.hasFetched || graveyardStore.ritualRequested;

  // If we don't need the ritual, dismiss immediately (was initialized to true to prevent flash)
  if (!needsRitual) {
    showRitual.value = false;
  }
  graveyardStore.clearRitualRequest();

  // Resolve offline authorization first (works on cold-start via the persisted
  // account + keychain), then fetch. On a fetch failure the store hydrates the
  // encrypted offline galaxy and sets `offline=true` so the badge/controls show.
  await resolveOfflineAuthorized();
  await graveyardStore.fetchLetters();
  await nextTick();
  await checkGalaxyState();

  // When the WebGL context is lost (GPU reset on any driver), TheVoid emits a
  // `void:context-lost` custom event that bubbles to the page root. Show the
  // retry fallback so the user can cleanly remount instead of a frozen black box.
  document.addEventListener('void:context-lost', onVoidError);

  // Don't auto-dismiss — let the ritual sequence complete on its own, and give
  // up waiting for a hung fetch so the reader is never trapped behind it.
  if (showRitual.value) {
    ritualGiveUp = setTimeout(() => {
      ritualGiveUp = null;
      showRitual.value = false;
    }, RITUAL_MAX_WAIT_MS);
  }
});

onUnmounted(() => {
  stopRitualGiveUp();
  document.removeEventListener('void:context-lost', onVoidError);
  stopGraveyardAudio();
  if (postAudio) {
    postAudio.pause();
    postAudio.removeAttribute('src');
    postAudio.load();
    postAudio = null;
  }
});

// ── UI state ───────────────────────────────────────────────────
const selectedLetter = ref<Letter | null>(null);
const drawerOpen = ref(false);
const replyTarget = ref<Letter | null>(null);
const voidRef = ref<InstanceType<typeof TheVoid> | null>(null);

// ── WebGL error handling ───────────────────────────────────────
// WebKit (Tauri) can block all WebGL on a page after a context loss.
// We catch the error, show a fallback, and allow the user to retry
// by forcing a full remount of TheVoid via a key change.
const webglFailed = ref(false);
const voidMountKey = ref(0);

function onVoidError() {
  webglFailed.value = true;
}

function retryWebgl() {
  webglFailed.value = false;
  voidMountKey.value++;
}

// Catch errors from the TheVoid / TresJS subtree so they don't crash the whole page
onErrorCaptured((err) => {
  const msg = String(err);
  if (msg.includes('WebGL') || msg.includes('context') || msg.includes('THREE')) {
    webglFailed.value = true;
    return false; // stop propagation
  }
  return true;
});

// Time Machine State
const timeProgress = ref(1.0); // 0.0 = Start (Oldest), 1.0 = Now (Newest)

const dateRange = computed(() => {
  const letters = graveyardStore.letters || [];
  if (letters.length === 0) return { min: Date.now(), max: Date.now() };
  let min = Infinity;
  let max = -Infinity;
  letters.forEach((l: Letter) => {
    const t = new Date(l.createdAt).getTime();
    if (!isNaN(t)) {
      if (t < min) min = t;
      if (t > max) max = t;
    }
  });
  if (!isFinite(min)) return { min: Date.now(), max: Date.now() };
  return { min, max };
});

const formattedCurrentDate = computed(() => {
  const { min, max } = dateRange.value;
  if (min === max) {
    const d = new Date(min);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }
  const current = min + (max - min) * timeProgress.value;
  const d = new Date(current);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
});

function onNodeClick(letter: Letter) {
  selectedLetter.value = letter;
}

function openDrawerWithMention(letter: Letter) {
  selectedLetter.value = null; // close LetterDialog first
  replyTarget.value = letter;
  drawerOpen.value = true;
}

function onTeleport(letterId: string) {
  selectedLetter.value = null;
  voidRef.value?.flyToNode(letterId);
}

// Random Trip / Search navigation — same animated flight as clicking a mention.
function onNavigate(letterId: string) {
  selectedLetter.value = null;
  voidRef.value?.flyToNode(letterId);
}

async function onSubmitLetter(
  payload: { content: string; alias: string; mentionId?: string },
  onResult?: (success: boolean) => void,
) {
  const result = await graveyardStore.submitLetter(payload);

  if (result.success) {
    playPostSound();
    $q.notify({
      type: 'positive',
      message:
        'your message has been received. we will review it shortly. if it is accepted, you will find it here.',
      position: 'bottom',
      timeout: 3000,
    });
    // Close drawer on success
    onResult?.(true);
  } else {
    $q.notify({
      type: 'negative',
      message: result.error || 'the void rejected your message.',
      position: 'bottom',
      timeout: 4000,
    });
    // Keep drawer open on failure
    onResult?.(false);
  }
  replyTarget.value = null;
}
</script>

<style scoped lang="scss">
.graveyard-page {
  position: relative;
  height: var(--app-height, 100vh);
  width: 100vw;
  overflow: hidden;

  .void-wrapper {
    position: absolute;
    inset: 0;
    z-index: 0;
    touch-action: none; /* allow Three.js OrbitControls to handle pinch-zoom */
  }
}

/* Red action button — MOURN prestige style */
.soul-btn {
  color: var(--primary);
  background: transparent;
  border-color: var(--primary);

  &:hover {
    background: rgba(255, 0, 0, 0.06);
  }

  &:active {
    background: rgba(255, 0, 0, 0.1);
  }
}

/* Galaxy offline download / sync indicator — small, mono, hairline border */
.galaxy-sync-btn {
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #bbb;
  font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 6px 12px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;
  border-radius: 0;
  text-shadow: 0 0 12px rgba(0, 0, 0, 0.9);

  &:hover:not(:disabled) {
    border-color: var(--primary);
    color: var(--primary);
    background: rgba(255, 0, 0, 0.06);
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }

  &.is-synced {
    border-color: rgba(0, 255, 65, 0.5);
    color: #00ff41;
  }

  &.is-stale {
    border-color: rgba(255, 179, 0, 0.55);
    color: #ffb300;
  }
}

/* Time slider with white track and red thumb — cross-browser */
.time-slider {
  width: 100%;
  height: 8px;
  outline: none;
  cursor: pointer;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background: transparent; /* let track pseudo-elements control color */
  margin: 6px 0;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.9;
  }

  /* ── Webkit track (Chrome, Safari, Edge) ── */
  &::-webkit-slider-runnable-track {
    width: 100%;
    height: 8px;
    background: #ffffff;
    border-radius: 10px;
    border: none;
  }

  /* ── Webkit thumb ── */
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    margin-top: -6px; /* vertically centre on 8 px track */
    background: var(--primary);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 8px rgba(255, 0, 0, 0.5);
    transition: all 0.2s;

    &:hover {
      transform: scale(1.1);
      box-shadow: 0 0 12px rgba(255, 0, 0, 0.8);
    }

    &:active {
      transform: scale(0.95);
    }
  }

  /* ── Firefox track ── */
  &::-moz-range-track {
    width: 100%;
    height: 8px;
    background: #ffffff;
    border-radius: 10px;
    border: none;
  }

  /* ── Firefox thumb ── */
  &::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: var(--primary);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 8px rgba(255, 0, 0, 0.5);
    transition: all 0.2s;

    &:hover {
      transform: scale(1.1);
      box-shadow: 0 0 12px rgba(255, 0, 0, 0.8);
    }

    &:active {
      transform: scale(0.95);
    }
  }

  /* ── Firefox progress fill (prevents default blue) ── */
  &::-moz-range-progress {
    background: #ffffff;
    border-radius: 10px;
    height: 8px;
  }
}
</style>

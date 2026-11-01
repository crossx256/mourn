<template>
  <div
    v-if="isTauri"
    class="tauri-titlebar"
    :class="{ 'tauri-titlebar--hidden': isFullscreen }"
    data-tauri-drag-region
  >
    <div class="tauri-titlebar__nav" data-tauri-drag-region>
      <button class="tauri-titlebar__icon-btn" type="button" aria-label="Go back" @click="goBack">
        <span aria-hidden="true">‹</span>
      </button>
      <button
        class="tauri-titlebar__icon-btn"
        type="button"
        aria-label="Go forward"
        @click="goForward"
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>

    <div class="tauri-titlebar__title" data-tauri-drag-region>
      <span class="tauri-titlebar__logo" aria-hidden="true">
        <MournLogoInline class="tauri-titlebar__logo-svg" />
      </span>
      <span class="tauri-titlebar__page">{{ currentPageLabel }}</span>
    </div>

    <div class="tauri-titlebar__controls">
      <button class="tauri-titlebar__btn" aria-label="Minimize" @click="minimize">&#x2500;</button>
      <button class="tauri-titlebar__btn" aria-label="Maximize" @click="toggleMaximize">
        {{ isMaximized ? '\u29C9' : '\u25A1' }}
      </button>
      <button
        class="tauri-titlebar__btn tauri-titlebar__btn--close"
        aria-label="Close"
        @click="closeWindow"
      >
        &#x2715;
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch as vueWatch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import MournLogoInline from 'src/components/icons/MournLogoInline.vue';
import { useAppSettingsStore } from 'src/stores/appSettings';

const $q = useQuasar();
const router = useRouter();
const appSettingsStore = useAppSettingsStore();

// ── State ────────────────────────────────────────────
const isTauri = ref(false);
const isMaximized = ref(false);
const isFullscreen = ref(false);
const currentPageLabel = ref('main');

const WINDOW_LABEL = 'main';
const TITLEBAR_EVENT = 'mourn:titlebar-label';

let cleanups: (() => void)[] = [];

type TitleBarLabelEvent = CustomEvent<{ label?: string }>;

function syncPageLabel(event: Event) {
  const customEvent = event as TitleBarLabelEvent;
  const nextLabel = customEvent.detail?.label?.trim();
  currentPageLabel.value = nextLabel || 'main';
}

// ── Raw Tauri 2 IPC ─────────────────────────────────
// Tauri 2 window plugin commands require { label } in the payload.
function tauriInvoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internals = (window as any).__TAURI_INTERNALS__;
  if (!internals) return Promise.reject('not in tauri');
  return internals.invoke(cmd, args) as Promise<T>;
}

// ── Window operations ────────────────────────────────
async function checkMaximized() {
  try {
    const result = await tauriInvoke<boolean>('plugin:window|is_maximized', {
      label: WINDOW_LABEL,
    });
    isMaximized.value = !!result;
  } catch {
    /* ignore */
  }
}

async function checkFullscreen() {
  try {
    const result = await tauriInvoke<boolean>('plugin:window|is_fullscreen', {
      label: WINDOW_LABEL,
    });
    isFullscreen.value = !!result;
  } catch {
    /* ignore */
  }
}

function minimize() {
  void tauriInvoke('plugin:window|minimize', { label: WINDOW_LABEL });
}

function toggleMaximize() {
  void tauriInvoke('plugin:window|toggle_maximize', { label: WINDOW_LABEL });
  setTimeout(() => void checkMaximized(), 120);
}

function closeWindow() {
  // "Stay minimized" is on: hide to the tray (keep running in the background
  // and keep receiving notifications) instead of quitting. The Rust
  // on_window_event net also hides the window for OS-level closes (Alt+F4).
  if (appSettingsStore.stayMinimized) {
    void tauriInvoke('plugin:window|hide', { label: WINDOW_LABEL });
    $q.notify({
      message: 'mourn is still running in the tray',
      position: 'bottom-right',
      color: 'primary',
      textColor: 'black',
      timeout: 2200,
      classes:
        'border border-solid border-[var(--primary)] font-mono lowercase tracking-widest text-weight-bold',
    });
    return;
  }
  void tauriInvoke('plugin:window|close', { label: WINDOW_LABEL });
}

function goBack() {
  router.back();
}

function goForward() {
  router.forward();
}

async function setFullscreen(full: boolean) {
  await tauriInvoke('plugin:window|set_fullscreen', { label: WINDOW_LABEL, value: full });
  isFullscreen.value = full;
}

async function toggleFullscreen() {
  const newState = !isFullscreen.value;
  await setFullscreen(newState);

  if (newState) {
    // Show mourn-styled alert on fullscreen enter
    $q.notify({
      message: 'press f11 or esc to exit fullscreen',
      position: 'top',
      color: 'primary',
      textColor: 'black',
      icon: 'mdi-shield-check',
      timeout: 3000,
      classes:
        'border border-solid border-[var(--primary)] font-mono lowercase tracking-widest text-weight-bold',
    });
  }
}

// ── Keyboard handler ─────────────────────────────────
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'F11') {
    e.preventDefault();
    void toggleFullscreen();
  }
  if (e.key === 'Escape' && isFullscreen.value) {
    e.preventDefault();
    void setFullscreen(false);
  }
}

// ── Lifecycle ────────────────────────────────────────
vueWatch(isFullscreen, (full: boolean) => {
  if (full) {
    document.body.classList.add('is-tauri-fullscreen');
  } else {
    document.body.classList.remove('is-tauri-fullscreen');
  }
});

onMounted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isTauri.value = !!(window as any).__TAURI_INTERNALS__;
  if (!isTauri.value) return;

  window.addEventListener(TITLEBAR_EVENT, syncPageLabel);
  cleanups.push(() => window.removeEventListener(TITLEBAR_EVENT, syncPageLabel));

  void checkMaximized();
  void checkFullscreen();

  // Track maximize state on resize
  const resizeHandler = () => {
    void checkMaximized();
    void checkFullscreen();
  };
  window.addEventListener('resize', resizeHandler);
  cleanups.push(() => window.removeEventListener('resize', resizeHandler));

  // F11 / Esc keybindings
  window.addEventListener('keydown', onKeyDown);
  cleanups.push(() => window.removeEventListener('keydown', onKeyDown));
});

onUnmounted(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
});
</script>

<style scoped>
.tauri-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 99999;
  height: var(--titlebar-height, 32px);
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  background: rgb(var(--m-bg-rgb, 0 0 0));
  border-bottom: 1px solid rgb(var(--m-border-rgb, 26 26 26));
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: drag;
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

/* Hide title bar in fullscreen */
.tauri-titlebar--hidden {
  transform: translateY(-100%);
  opacity: 0;
  pointer-events: none;
}

.tauri-titlebar__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--m-accent-rgb, 255 0 0));
  pointer-events: none;
}

.tauri-titlebar__logo-svg {
  width: 18px;
  height: 18px;
  display: block;
  filter: drop-shadow(0 0 5px rgb(var(--m-accent-rgb, 255 0 0) / 0.35));
}

.tauri-titlebar__nav {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding-left: 0.5rem;
  -webkit-app-region: no-drag;
}

.tauri-titlebar__title {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0 1rem;
  overflow: hidden;
}

.tauri-titlebar__page {
  color: rgb(var(--m-text-rgb, 238 238 238));
  font-family: monospace, 'Courier New', Courier;
  font-size: 0.8rem;
  letter-spacing: 0.12em;
  text-transform: lowercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tauri-titlebar__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgb(var(--m-accent-rgb, 255 0 0));
  font-size: 20px;
  line-height: 1;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
  -webkit-app-region: no-drag;
}

.tauri-titlebar__icon-btn:hover {
  background: rgb(var(--m-hover-rgb, 26 26 26));
  color: rgb(var(--m-text-rgb, 238 238 238));
}

.tauri-titlebar__controls {
  display: flex;
  align-items: stretch;
  height: 100%;
  justify-self: end;
  -webkit-app-region: no-drag;
}

.tauri-titlebar__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: rgb(var(--m-accent-rgb, 255 0 0));
  font-size: 14px;
  font-family: monospace, 'Courier New', Courier;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  -webkit-app-region: no-drag;
}

.tauri-titlebar__btn:hover {
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.16);
  color: rgb(var(--m-accentAlt-rgb, 248 81 73));
}

.tauri-titlebar__btn--close:hover {
  background: rgb(var(--m-accent-rgb, 255 0 0));
  color: rgb(var(--m-onAccent-rgb, 0 0 0));
}
</style>

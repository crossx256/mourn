import { ref, onMounted, onUnmounted, unref, watch, type Ref } from 'vue';
import { useRenderingPolicy } from './useRenderingPolicy';

/**
 * Composable: useTitleGlitch
 *
 * Recreates the legacy mourn title-glitch effect:
 *  1. Types the title character-by-character with random block-element
 *     "glitch" characters between each real character.
 *  2. Pauses when the full title is revealed.
 *  3. Erases character-by-character.
 *  4. Loops forever.
 *
 * Returns `start()` and `stop()` for manual control, plus an `active` ref.
 *
 * Memory-efficient: uses a single `setInterval`; automatically clears on
 * component unmount.
 */

const GLITCH_CHARS = [
  '▀',
  '▁',
  '▂',
  '▃',
  '▄',
  '▅',
  '▆',
  '▇',
  '█',
  '▉',
  '▊',
  '▋',
  '▌',
  '▍',
  '▎',
  '▏',
  '▐',
  '░',
  '▒',
  '▓',
  '▔',
  '▕',
  '▖',
  '▗',
  '▘',
  '▙',
  '▚',
  '▛',
  '▜',
  '▝',
  '▞',
  '▟',
] as const;

function randomGlyph(): string {
  return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)] as string;
}

export interface TitleGlitchOptions {
  /** Text to glitch-type. Defaults to `'@ mourn'`. */
  title?: string | Ref<string> | (() => string);
  /** Interval tick speed in ms. Defaults to `120`. */
  delay?: number | Ref<number> | (() => number);
  /** Number of glitch chars shown before each real char reveals. Defaults to `6`. */
  maxGlitchCycles?: number;
  /** Ticks to pause when the full title is visible. Defaults to `15`. */
  pauseDuration?: number;
  /** Start automatically on creation. Defaults to `true`. */
  immediate?: boolean;
}

export function useTitleGlitch(options: TitleGlitchOptions = {}) {
  // SSR GUARD — server must never touch document.title
  // Return a no-op API so callers don't need conditional checks
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { active: ref(false), start: () => {}, stop: () => {} };
  }

  const {
    title = '@ mourn',
    delay = 120,
    maxGlitchCycles = 6,
    pauseDuration = 15,
    immediate = true,
  } = options;

  const { animate } = useRenderingPolicy();
  const active: Ref<boolean> = ref(false);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  // Animation state
  let counter = 0;
  let direction = true; // true = typing forward, false = erasing
  let currentGlitchCount = 0;
  let pauseCounter = 0;
  let isPaused = false;

  let currentDelay = 120;

  /** Store the original title so we can restore on stop. */
  let originalTitle: string | null = null;

  function resolveTitle() {
    if (typeof title === 'function') return title();
    return unref(title);
  }

  function resolveDelay() {
    const value = typeof delay === 'function' ? delay() : unref(delay);
    return Number.isFinite(value) && value > 0 ? Math.max(80, value) : 120;
  }

  function restartInterval(nextDelay: number) {
    if (intervalId !== null) {
      clearInterval(intervalId);
    }
    currentDelay = nextDelay;
    intervalId = setInterval(tick, currentDelay);
  }

  function tick() {
    const nextDelay = resolveDelay();
    if (nextDelay !== currentDelay) {
      restartInterval(nextDelay);
    }
    const currentTitle = resolveTitle() || '@ mourn';
    let text = '';

    if (isPaused) {
      pauseCounter++;
      if (pauseCounter >= pauseDuration) {
        isPaused = false;
        pauseCounter = 0;
        direction = false; // start erasing
      }
      text = currentTitle;
    } else if (direction) {
      // ---- Typing forward ----
      if (counter < currentTitle.length) {
        for (let i = 0; i < counter; i++) text += currentTitle[i];
        if (currentGlitchCount < maxGlitchCycles) {
          text += randomGlyph();
          currentGlitchCount++;
        } else {
          text += currentTitle[counter];
          counter++;
          currentGlitchCount = 0;
        }
      } else {
        isPaused = true;
        text = currentTitle;
      }
    } else {
      // ---- Erasing ----
      if (counter > 0) {
        counter--;
        text = currentTitle.slice(0, counter);
        if (counter === 0) text = randomGlyph();
      } else {
        direction = true;
        currentGlitchCount = 0;
        text = randomGlyph();
      }
    }

    document.title = text || randomGlyph();
  }

  function resetState() {
    counter = 0;
    direction = true;
    currentGlitchCount = 0;
    pauseCounter = 0;
    isPaused = false;
  }

  function start() {
    if (typeof document === 'undefined') return; // SSR guard
    if (active.value) return; // already requested
    originalTitle = document.title;
    resetState();
    active.value = true;
    syncAnimation();
  }

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    active.value = false;
    if (originalTitle !== null) {
      document.title = originalTitle;
      originalTitle = null;
    }
  }

  function syncAnimation() {
    if (!active.value || typeof document === 'undefined') return;
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = null;
    if (animate.value) {
      currentDelay = resolveDelay();
      intervalId = setInterval(tick, currentDelay);
    } else {
      document.title = resolveTitle() || '@ mourn';
    }
  }
  watch([animate, () => resolveTitle()], syncAnimation);

  // Auto-call start if immediate is true, but ONLY on/after mount to avoid
  // hydration mismatches (server renders title X, client renders title Y).
  onMounted(() => {
    if (immediate) {
      start();
    }
  });

  // Auto-cleanup on component unmount
  onUnmounted(stop);

  return { active, start, stop };
}

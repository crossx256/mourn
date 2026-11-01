import { NOTIFICATION_SOUND_DATA_URI } from './notificationSoundData';

/**
 * Notification sound — plays the mourn_notification.mp3 chime
 * when a new message or notification arrives.
 *
 * The audio bytes are loaded from NOTIFICATION_SOUND_DATA_URI (a data: URI
 * embedded in source) rather than from `/mourn_notification.mp3` on the asset
 * protocol. In the packaged Tauri app the mp3 is served over a custom scheme
 * (`tauri://` / `http://tauri.localhost`), where HTMLMediaElement decoding is
 * unreliable in some webviews (notably WebKitGTK) — it silently never plays.
 * A data: URI carries the exact bytes in-memory and plays identically in dev
 * and prod with zero network/protocol dependency.
 *
 * Autoplay-policy reality (why HTML5-audio notification chimes break
 * "for no reason" in the Tauri WebKitGTK webview):
 *   • A muted `play()` is NOT a reliable unlock. WebKitGTK can resolve the
 *     muted play but still reject the later unmuted play, or reject both.
 *     We must therefore gate unlock on a REAL unmuted play, never assume a
 *     blocked play means "unlocked".
 *   • The unlock call MUST happen synchronously inside a user gesture. The
 *     previous implementation fired it from an `import(...).then(...)`
 *     microtask, by which point the transient activation had already
 *     expired — so the unlock silently never took effect. Callers must
 *     import this module statically and call `unlockAudio()` directly from
 *     the gesture handler.
 *   • An `Audio` element whose source has not finished loading can resolve
 *     `play()` with silence. We wait for the `canplay` event before the
 *     very first play so the chime is actually heard.
 */

let audio: HTMLAudioElement | null = null;
let loadPromise: Promise<HTMLAudioElement> | null = null;
let lastPlayedAt = 0;
let pendingSounds = 0;
let isUnlocked = false;
let isFlushing = false;

// Minimum 1 second between sounds to avoid spam
const DEBOUNCE_MS = 1000;

const LOAD_TIMEOUT_MS = 4000;

function createAudio(): HTMLAudioElement {
  const nextAudio = new Audio(NOTIFICATION_SOUND_DATA_URI);
  // Full volume on purpose: this chime competes with the device's media volume,
  // so anything below 1.0 reads as "the in-app notification is barely audible"
  // even at a normal volume setting. Callers that need it quieter should lower
  // the device volume, not the asset.
  nextAudio.volume = 1;
  nextAudio.preload = 'auto';
  return nextAudio;
}

/**
 * Ensure we have an audio element whose metadata is loaded, resolving with
 * the playable element. Never rejects on its own (falls back to a ready
 * element after a short wait or timeout) so a slow/blocked resource can't
 * hard-fail the notification path.
 */
function ensureLoadedAudio(): Promise<HTMLAudioElement> {
  if (audio && audio.readyState >= 1) {
    return Promise.resolve(audio);
  }

  if (loadPromise) return loadPromise;

  const el = audio ?? (audio = createAudio());

  loadPromise = new Promise<HTMLAudioElement>((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        if (loadPromise) loadPromise = null;
        resolve(el);
      }
    };

    if (el.readyState >= 1) {
      done();
      return;
    }

    const onReady = () => done();
    const onError = () => done();
    el.addEventListener('canplay', onReady, { once: true });
    el.addEventListener('loadeddata', onReady, { once: true });
    // If the resource can never load, still resolve so downstream plays can
    // at least attempt against the element.
    el.addEventListener('error', onError, { once: true });

    // Hard fallback — never leave the promise dangling.
    window.setTimeout(done, LOAD_TIMEOUT_MS);

    el.load();
  });

  return loadPromise;
}

async function playOnce(): Promise<boolean> {
  const el = await ensureLoadedAudio();

  // If the element failed to decode, recreate it once so a transient load
  // error can't permanently kill sound for the session.
  if (el.error) {
    // console.warn for diagnostics; no-console not enforced in this repo.
    console.warn('[NotifSound] audio element has an error; recreating.', {
      src: el.src,
      error: el.error?.code,
      networkState: el.networkState,
      readyState: el.readyState,
    });
    audio = createAudio();
    loadPromise = null;
    const fresh = await ensureLoadedAudio();
    fresh.currentTime = 0;
    try {
      await fresh.play();
      lastPlayedAt = Date.now();
      return true;
    } catch (err) {
      console.warn('[NotifSound] retry play failed:', err);
      return false;
    }
  }

  el.currentTime = 0;

  try {
    await el.play();
    lastPlayedAt = Date.now();
    return true;
  } catch (err) {
    console.warn('[NotifSound] play() rejected (autoplay blocked or unplayable).', {
      reason: err instanceof Error ? err.message : err,
      networkState: el.networkState,
      readyState: el.readyState,
      muted: el.muted,
    });
    return false;
  }
}

async function flushPendingSounds(): Promise<void> {
  if (!isUnlocked || isFlushing || pendingSounds <= 0) return;

  isFlushing = true;
  try {
    while (isUnlocked && pendingSounds > 0) {
      const played = await playOnce();
      if (!played) {
        // A blocked/failed play after unlock — keep one pending attempt so a
        // later flush or gesture can still recover, then stop.
        pendingSounds = Math.max(pendingSounds, 1);
        return;
      }

      pendingSounds -= 1;

      if (pendingSounds > 0) {
        await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));
      }
    }
  } finally {
    isFlushing = false;
  }
}

/**
 * Must be called from a user interaction (click/keydown/pointerdown) and,
 * critically, SYNCHRONOUSLY within that handler — do NOT call this from an
 * `import().then(...)` microtask. The media element is created and `play()`
 * is invoked in the gesture's call stack so the webview grants the unlock.
 *
 * Strategy: autoplay policy in every engine (including WebKitGTK) ALLOWS
 * muted playback without a gesture. Firing a muted play/pause cycle here (a)
 * primes the element and (b) unlocks it, so subsequent UNMUTED notification
 * plays from anywhere are permitted. `isUnlocked` is only set once the muted
 * play actually succeeds — a blocked play keeps us locked so the next genuine
 * gesture can retry instead of silently "succeeding" with silence.
 */
export function unlockAudio(): void {
  // Recreate the element if the previous one errored out, so a transient
  // load failure can't permanently mute the chime for the session.
  if (audio && audio.error) {
    audio = null;
    loadPromise = null;
  }
  if (!audio) audio = createAudio();

  const el = audio;
  el.muted = true;

  void el
    .play()
    .then(() => {
      el.pause();
      el.currentTime = 0;
      el.muted = false;
      isUnlocked = true;
      console.log('[NotifSound] audio unlocked by user gesture.');
      void flushPendingSounds();
    })
    .catch((err) => {
      el.muted = false;
      isUnlocked = false;
      console.warn('[NotifSound] muted unlock play was blocked.', {
        reason: err instanceof Error ? err.message : err,
        readyState: el.readyState,
      });
    });
}

/**
 * Play the notification sound. Debounced to prevent rapid-fire sounds.
 * Safe to call even if audio is locked — will silently no-op (the sound is
 * queued and replayed on the next successful unlock).
 */
/**
 * True when the mobile shell is in front of the user.
 *
 * While the app is open, arrivals are announced by an in-app banner and must stay
 * SILENT — the system notification (which carries the sound) is what covers the case
 * where the app is not in front of the user. Playing this chime in both places made a
 * sound while the app was open, which is exactly what should not happen.
 */
function isMobileShellVisible(): boolean {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false;
  return typeof (window as { Capacitor?: unknown }).Capacitor !== 'undefined';
}

export async function playNotificationSound(): Promise<void> {
  if (isMobileShellVisible()) return;
  const now = Date.now();
  if (now - lastPlayedAt < DEBOUNCE_MS) {
    pendingSounds += 1;
    return;
  }

  if (!isUnlocked) {
    // Not unlocked by a gesture yet. Attempt a direct play anyway (some
    // webviews allow it); if it succeeds we're unlocked from here on. If it
    // is blocked, queue it so the next unlock can recover.
    const played = await playOnce();
    if (played) {
      isUnlocked = true;
      return;
    }
    pendingSounds += 1;
    void flushPendingSounds();
    return;
  }

  const played = await playOnce();
  if (!played) {
    pendingSounds += 1;
  }
}

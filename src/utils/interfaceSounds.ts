const HOVER_SOUND_URLS = ['/audio/mourn-hover.mp3', '/audio/mourn-hover-2.mp3'] as const;
const INTERACTIVE_SELECTOR = [
  'button:not(:disabled)',
  'a[href]',
  '[role="button"]:not([aria-disabled="true"])',
  '.q-item--clickable',
  '.q-tab',
  '.q-chip--clickable',
].join(',');

const HOVER_VOLUME = 0.2;
const HOVER_DEBOUNCE_MS = 120;

/**
 * Adds subtle, alternating hover sounds to pointer-driven interactive controls.
 * Returns a cleanup function so the app shell can remove every listener.
 */
export function installInterfaceHoverSounds(): () => void {
  const sounds = HOVER_SOUND_URLS.map((src) => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = HOVER_VOLUME;
    return audio;
  });

  let nextSoundIndex = 0;
  let lastPlayedAt = 0;
  let lastTarget: Element | null = null;
  let unlocked = false;

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;

    for (const sound of sounds) {
      sound.muted = true;
      void sound
        .play()
        .then(() => {
          sound.pause();
          sound.currentTime = 0;
          sound.muted = false;
        })
        .catch(() => {
          sound.muted = false;
        });
    }
  };

  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    if (!(event.target instanceof Element)) return;

    const target = event.target.closest(INTERACTIVE_SELECTOR);
    if (!target || target === lastTarget) return;
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;

    lastTarget = target;

    const now = Date.now();
    if (now - lastPlayedAt < HOVER_DEBOUNCE_MS) return;
    lastPlayedAt = now;

    const sound = sounds[nextSoundIndex];
    nextSoundIndex = (nextSoundIndex + 1) % sounds.length;
    if (!sound) return;

    for (const otherSound of sounds) {
      if (otherSound === sound) continue;
      otherSound.pause();
      otherSound.currentTime = 0;
    }

    sound.currentTime = 0;
    void sound.play().catch(() => {
      // Browsers may reject hover playback before the first user gesture.
    });
  };

  const onPointerOut = (event: PointerEvent) => {
    if (!lastTarget) return;
    if (event.relatedTarget instanceof Node && lastTarget.contains(event.relatedTarget)) return;
    lastTarget = null;
  };

  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });

  return () => {
    document.removeEventListener('pointerdown', unlock, { capture: true });
    document.removeEventListener('keydown', unlock, { capture: true });
    document.removeEventListener('pointerover', onPointerOver);
    document.removeEventListener('pointerout', onPointerOut);

    for (const sound of sounds) {
      sound.pause();
      sound.removeAttribute('src');
      sound.load();
    }
  };
}
